alter table staff_membership_baseline_reviews add column if not exists revision_number integer not null default 1;
alter table staff_membership_baseline_reviews add column if not exists previous_revision_id uuid references staff_membership_baseline_reviews(id) on delete restrict;
alter table staff_membership_baseline_reviews add column if not exists review_type text not null default 'initial';
alter table staff_membership_baseline_reviews add column if not exists is_current_revision boolean not null default true;
alter table staff_membership_baseline_reviews add column if not exists is_authoritative boolean not null default false;
alter table staff_membership_baseline_reviews add column if not exists approved_by_user_id uuid references user_accounts(id) on delete restrict;
alter table staff_membership_baseline_reviews add column if not exists reopened_at timestamptz;
alter table staff_membership_baseline_reviews add column if not exists reopened_by_user_id uuid references user_accounts(id) on delete restrict;
alter table staff_membership_baseline_reviews add column if not exists reopened_by_name text;
alter table staff_membership_baseline_reviews add column if not exists reopen_reason text;

do $$ declare constraint_name text; begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid='staff_membership_baseline_reviews'::regclass
      and contype in ('u','c')
      and (pg_get_constraintdef(oid) like '%UNIQUE (outlet_scope_id, baseline_month)%'
        or pg_get_constraintdef(oid) like '%status%')
  loop execute format('alter table staff_membership_baseline_reviews drop constraint %I',constraint_name); end loop;
end $$;

update staff_membership_baseline_reviews
set is_authoritative=(status='approved'), revision_number=1, review_type='initial', is_current_revision=true;

alter table staff_membership_baseline_reviews add constraint staff_membership_baseline_revision_number_check check (revision_number>=1);
alter table staff_membership_baseline_reviews add constraint staff_membership_baseline_review_type_check check (review_type in ('initial','correction'));
alter table staff_membership_baseline_reviews add constraint staff_membership_baseline_revision_status_check check (status in ('in_review','correction_in_review','approved','superseded'));
alter table staff_membership_baseline_reviews add constraint staff_membership_baseline_revision_approval_check check ((status in ('approved','superseded') and approved_at is not null and approved_by is not null) or status in ('in_review','correction_in_review'));
create unique index if not exists staff_membership_baseline_revision_unique on staff_membership_baseline_reviews(outlet_scope_id,baseline_month,revision_number);
create unique index if not exists staff_membership_baseline_current_revision_unique on staff_membership_baseline_reviews(outlet_scope_id,baseline_month) where is_current_revision=true;
create unique index if not exists staff_membership_baseline_authoritative_unique on staff_membership_baseline_reviews(outlet_scope_id,baseline_month) where is_authoritative=true;
create unique index if not exists staff_membership_baseline_active_correction_unique on staff_membership_baseline_reviews(outlet_scope_id,baseline_month) where status='correction_in_review';

alter table staff_membership_baseline_selections add column if not exists staff_name_snapshot text;
alter table staff_membership_baseline_selections add column if not exists staff_number_snapshot text;
alter table staff_membership_baseline_selections add column if not exists designation_snapshot text;
update staff_membership_baseline_selections selection
set staff_name_snapshot=coalesce(selection.staff_name_snapshot,staff.full_name),
    staff_number_snapshot=coalesce(selection.staff_number_snapshot,staff.staff_number),
    designation_snapshot=coalesce(selection.designation_snapshot,staff.position_key)
from staff where staff.id=selection.staff_id;

alter table staff_membership_history add column if not exists baseline_revision_id uuid references staff_membership_baseline_reviews(id) on delete restrict;
alter table staff_membership_history add column if not exists is_current_baseline boolean not null default true;
update staff_membership_history history set baseline_revision_id=review.id
from staff_membership_baseline_reviews review
where history.source='baseline_manager_review' and history.baseline_revision_id is null
  and history.outlet_scope_id=review.outlet_scope_id
  and to_char(history.effective_from,'YYYY-MM')=review.baseline_month
  and review.revision_number=1;

drop index if exists staff_membership_identical_period_unique;
drop index if exists staff_membership_one_open_regular_outlet;
create unique index staff_membership_identical_period_unique on staff_membership_history(staff_id,outlet_scope_id,membership_dimension,effective_from,coalesce(effective_to,'9999-12-31'::date)) where is_current_baseline=true;
create unique index staff_membership_one_open_regular_outlet on staff_membership_history(staff_id) where membership_dimension='regular_outlet' and effective_to is null and is_current_baseline=true;

create or replace function prevent_regular_outlet_membership_overlap() returns trigger language plpgsql as $$
begin
  if new.membership_dimension='regular_outlet' and new.is_current_baseline=true and exists(
    select 1 from staff_membership_history existing
    where existing.staff_id=new.staff_id and existing.membership_dimension='regular_outlet'
      and existing.is_current_baseline=true and existing.id<>new.id
      and existing.effective_from<=coalesce(new.effective_to,'9999-12-31'::date)
      and new.effective_from<=coalesce(existing.effective_to,'9999-12-31'::date)
  ) then raise exception 'Regular outlet membership overlaps an existing period.' using errcode='23514'; end if;
  return new;
end $$;
