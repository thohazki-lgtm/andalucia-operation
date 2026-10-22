do $$
begin
  if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='employee_timesheet_days') then
    raise exception 'Migration 027 requires Migration 024 employee timesheets.' using errcode='23514';
  end if;
  if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='accumulated_off_week_evaluations') then
    raise exception 'Migration 027 requires Migration 026 accumulated OFF tracking.' using errcode='23514';
  end if;
end $$;

alter table employee_timesheet_days
  add constraint employee_timesheet_days_id_sheet_unique unique(id,timesheet_id);

create table if not exists employee_timesheet_overtime (
  id uuid primary key,
  timesheet_id uuid not null references employee_timesheets(id) on delete restrict,
  timesheet_day_id uuid not null,
  duration_minutes integer not null check(duration_minutes between 0 and 120),
  status text check(status in ('pending','approved','rejected')),
  revision integer not null default 1 check(revision>=1),
  submitted_by_user_id uuid not null references user_accounts(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  reviewed_by_user_id uuid references user_accounts(id) on delete restrict,
  reviewed_at timestamptz,
  rejection_reason text,
  created_by_user_id uuid not null references user_accounts(id) on delete restrict,
  updated_by_user_id uuid not null references user_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(timesheet_day_id),
  foreign key(timesheet_day_id,timesheet_id) references employee_timesheet_days(id,timesheet_id) on delete restrict,
  check(
    (duration_minutes=0 and status is null and reviewed_by_user_id is null and reviewed_at is null and rejection_reason is null)
    or (duration_minutes>0 and status='pending' and reviewed_by_user_id is null and reviewed_at is null and rejection_reason is null)
    or (duration_minutes>0 and status='approved' and reviewed_by_user_id is not null and reviewed_at is not null and rejection_reason is null)
    or (duration_minutes>0 and status='rejected' and reviewed_by_user_id is not null and reviewed_at is not null and length(trim(rejection_reason))>=3)
  )
);

create index if not exists employee_timesheet_overtime_sheet_idx on employee_timesheet_overtime(timesheet_id,status);

create table if not exists employee_timesheet_overtime_audits (
  id uuid primary key,
  overtime_id uuid not null references employee_timesheet_overtime(id) on delete restrict,
  timesheet_id uuid not null references employee_timesheets(id) on delete restrict,
  timesheet_day_id uuid not null references employee_timesheet_days(id) on delete restrict,
  actor_user_id uuid not null references user_accounts(id) on delete restrict,
  action text not null check(action in ('submitted','employee_corrected','manager_corrected','approved','rejected','cleared')),
  before_data jsonb,
  after_data jsonb not null,
  reason text,
  created_at timestamptz not null default now(),
  check(action not in ('manager_corrected','rejected') or length(trim(reason))>=3)
);

create index if not exists employee_timesheet_overtime_audit_idx on employee_timesheet_overtime_audits(overtime_id,created_at);
