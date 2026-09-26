alter table bill_tip_distributions add column if not exists version_number integer not null default 1;
alter table bill_tip_distributions add column if not exists is_current boolean not null default false;
alter table bill_tip_distributions add column if not exists previous_version_id uuid references bill_tip_distributions(id) on delete restrict;
alter table bill_tip_distributions add column if not exists correction_reason text;
alter table bill_tip_distributions add column if not exists reopened_by_user_id uuid references user_accounts(id) on delete restrict;
alter table bill_tip_distributions add column if not exists reopened_by_name text;
alter table bill_tip_distributions add column if not exists finalized_by_user_id uuid references user_accounts(id) on delete restrict;
alter table bill_tip_distributions add column if not exists finalized_by_name text;
alter table bill_tip_distributions add column if not exists regular_staff_distributed numeric(14,2) not null default 0 check(regular_staff_distributed>=0);
alter table bill_tip_distributions add column if not exists reconciliation_total numeric(14,2) not null default 0 check(reconciliation_total>=0);
alter table bill_tip_distributions add column if not exists finalization_key text;
alter table bill_tip_distributions add column if not exists correction_key text;

do $$ declare constraint_name text; begin
  for constraint_name in select conname from pg_constraint where conrelid='bill_tip_distributions'::regclass and contype in ('u','c') and (pg_get_constraintdef(oid) like '%distribution_month%' or pg_get_constraintdef(oid) like '%status%')
  loop execute format('alter table bill_tip_distributions drop constraint %I',constraint_name); end loop;
end $$;
drop index if exists bill_tip_distribution_outlet_month_unique;

do $$ begin
  if exists(select 1 from bill_tip_distributions where status='finalized') then
    raise exception 'Existing finalized Bill Tip rows require explicit historical identity review before Migration 012.' using errcode='23514';
  end if;
end $$;

update bill_tip_distributions set version_number=1,is_current=false,
  regular_staff_distributed=greatest(remaining_team_pool-undistributed_remainder,0),
  reconciliation_total=external_allocation_total+greatest(remaining_team_pool-undistributed_remainder,0)+undistributed_remainder;

alter table bill_tip_distributions add constraint bill_tip_version_number_check check(version_number>=1);
alter table bill_tip_distributions add constraint bill_tip_version_status_check check(status in ('draft','correction_in_review','finalized','superseded'));
alter table bill_tip_distributions add constraint bill_tip_current_status_check check(not is_current or status='finalized');
alter table bill_tip_distributions add constraint bill_tip_correction_lineage_check check(status<>'correction_in_review' or (previous_version_id is not null and length(trim(correction_reason))>0 and reopened_at is not null and reopened_by_user_id is not null and length(trim(reopened_by_name))>0));
alter table bill_tip_distributions add constraint bill_tip_finalizer_identity_check check(status not in ('finalized','superseded') or (finalized_at is not null and finalized_by_user_id is not null and length(trim(finalized_by_name))>0));
create unique index bill_tip_distribution_version_unique on bill_tip_distributions(outlet_scope_id,distribution_month,version_number);
create unique index bill_tip_distribution_current_finalized_unique on bill_tip_distributions(outlet_scope_id,distribution_month) where is_current=true and status='finalized';
create unique index bill_tip_distribution_active_correction_unique on bill_tip_distributions(outlet_scope_id,distribution_month) where status='correction_in_review';
create unique index bill_tip_distribution_finalization_key_unique on bill_tip_distributions(outlet_scope_id,distribution_month,finalization_key) where finalization_key is not null;
create unique index bill_tip_distribution_correction_key_unique on bill_tip_distributions(outlet_scope_id,distribution_month,correction_key) where correction_key is not null;

alter table bill_tip_staff_allocations add column if not exists membership_effective_from date;
alter table bill_tip_staff_allocations add column if not exists membership_effective_to date;
alter table bill_tip_staff_allocations add column if not exists other_excluded_days integer not null default 0 check(other_excluded_days>=0);

create or replace function protect_finalized_bill_tip_version() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Finalized Bill Tip versions cannot be deleted.' using errcode='23514'; end if;
  if old.status in ('finalized','superseded') then
    if old.status='finalized' and new.status='superseded' and new.is_current=false
       and (to_jsonb(new)-array['status','is_current','updated_at','updated_by'])=(to_jsonb(old)-array['status','is_current','updated_at','updated_by']) then return new; end if;
    raise exception 'Finalized Bill Tip versions are immutable.' using errcode='23514';
  end if;
  return new;
end $$;
drop trigger if exists bill_tip_version_immutable on bill_tip_distributions;
create trigger bill_tip_version_immutable before update or delete on bill_tip_distributions for each row execute function protect_finalized_bill_tip_version();

create or replace function protect_finalized_bill_tip_child() returns trigger language plpgsql as $$
declare parent_id uuid; parent_status text;
begin
  parent_id=case when tg_op='DELETE' then old.distribution_id else new.distribution_id end;
  select status into parent_status from bill_tip_distributions where id=parent_id;
  if parent_status in ('finalized','superseded') then raise exception 'Finalized Bill Tip snapshot allocations are immutable.' using errcode='23514'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists bill_tip_staff_snapshot_immutable on bill_tip_staff_allocations;
create trigger bill_tip_staff_snapshot_immutable before insert or update or delete on bill_tip_staff_allocations for each row execute function protect_finalized_bill_tip_child();
drop trigger if exists bill_tip_external_snapshot_immutable on bill_tip_manual_allocations;
create trigger bill_tip_external_snapshot_immutable before insert or update or delete on bill_tip_manual_allocations for each row execute function protect_finalized_bill_tip_child();
