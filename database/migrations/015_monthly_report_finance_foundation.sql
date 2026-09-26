create table if not exists monthly_report_inputs (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  month_start date not null check(month_start=date_trunc('month',month_start)::date),
  revision_number integer not null default 1 check(revision_number>=1),
  finance_status text not null default 'not_entered' check(finance_status in ('not_entered','entered','verified','verified_with_variance')),
  finance_payload jsonb not null default '{}'::jsonb check(jsonb_typeof(finance_payload)='object'),
  manager_commentary text not null default '',
  follow_ups_changes text not null default '',
  verified_by_user_id uuid references user_accounts(id) on delete restrict,
  verified_by_name_snapshot text,
  verified_at timestamptz,
  created_by_user_id uuid not null references user_accounts(id) on delete restrict,
  created_by_name_snapshot text not null check(length(trim(created_by_name_snapshot))>0),
  created_at timestamptz not null default now(),
  updated_by_user_id uuid not null references user_accounts(id) on delete restrict,
  updated_by_name_snapshot text not null check(length(trim(updated_by_name_snapshot))>0),
  updated_at timestamptz not null default now(),
  constraint monthly_report_finance_verification_identity_check check(
    (finance_status in ('not_entered','entered') and verified_by_user_id is null and verified_by_name_snapshot is null and verified_at is null)
    or
    (finance_status in ('verified','verified_with_variance') and verified_by_user_id is not null and length(trim(verified_by_name_snapshot))>0 and verified_at is not null)
  ),
  unique(outlet_scope_id,month_start)
);

create index if not exists monthly_report_inputs_period_idx
  on monthly_report_inputs(outlet_scope_id,month_start desc);

create or replace function protect_monthly_report_input_update() returns trigger language plpgsql as $$
begin
  if new.id<>old.id or new.outlet_scope_id<>old.outlet_scope_id or new.month_start<>old.month_start
     or new.created_by_user_id<>old.created_by_user_id or new.created_by_name_snapshot<>old.created_by_name_snapshot
     or new.created_at<>old.created_at then
    raise exception 'Monthly Report identity and creation evidence are immutable.' using errcode='23514';
  end if;
  if new.revision_number<>old.revision_number+1 then
    raise exception 'Monthly Report update must advance exactly one revision.' using errcode='40001';
  end if;
  if old.finance_status in ('verified','verified_with_variance') and new.finance_payload is distinct from old.finance_payload
     and not (new.finance_status='entered' and new.verified_by_user_id is null and new.verified_by_name_snapshot is null and new.verified_at is null) then
    raise exception 'Editing verified Finance inputs must clear verification.' using errcode='23514';
  end if;
  return new;
end $$;

drop trigger if exists monthly_report_input_update_guard on monthly_report_inputs;
create trigger monthly_report_input_update_guard before update on monthly_report_inputs
  for each row execute function protect_monthly_report_input_update();
