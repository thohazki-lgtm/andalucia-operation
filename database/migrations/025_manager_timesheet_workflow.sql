alter table employee_timesheets
  drop constraint if exists employee_timesheets_status_check;

alter table employee_timesheets
  add constraint employee_timesheets_status_check
  check (status in ('open','submitted','approved','locked'));

alter table employee_timesheet_day_audits
  add column if not exists reason text;

create table if not exists employee_timesheet_month_audits (
  id uuid primary key,
  timesheet_id uuid not null references employee_timesheets(id) on delete restrict,
  actor_user_id uuid references user_accounts(id) on delete set null,
  action text not null check (action in ('submitted','approved','locked','reopened')),
  previous_status text not null check (previous_status in ('open','submitted','approved','locked')),
  new_status text not null check (new_status in ('open','submitted','approved','locked')),
  reason text,
  snapshot_data jsonb not null,
  created_at timestamptz not null default now(),
  check (action <> 'reopened' or length(trim(reason)) > 0)
);

create index if not exists employee_timesheet_month_audits_sheet_idx
  on employee_timesheet_month_audits(timesheet_id, created_at);
