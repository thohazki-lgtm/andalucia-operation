create table if not exists employee_timesheets (
  id uuid primary key,
  staff_id uuid not null references staff(id) on delete restrict,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  month_start date not null,
  status text not null default 'open' check (status in ('open','submitted')),
  reopened_until timestamptz,
  reopened_by_user_id uuid references user_accounts(id) on delete set null,
  reopen_reason text,
  created_by_user_id uuid references user_accounts(id) on delete set null,
  updated_by_user_id uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (month_start = date_trunc('month', month_start)::date),
  check ((reopened_until is null and reopened_by_user_id is null and reopen_reason is null) or (reopened_until is not null and reopened_by_user_id is not null and length(trim(reopen_reason)) > 0)),
  unique(staff_id, month_start)
);

create table if not exists employee_timesheet_days (
  id uuid primary key,
  timesheet_id uuid not null references employee_timesheets(id) on delete cascade,
  work_date date not null,
  state text not null default 'draft' check (state in ('draft','confirmed')),
  first_time_in time,
  first_time_out time,
  second_time_in time,
  second_time_out time,
  total_minutes integer not null default 0 check (total_minutes between 0 and 1440),
  revision integer not null default 1 check (revision >= 1),
  confirmed_at timestamptz,
  updated_by_user_id uuid references user_accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state <> 'confirmed' or confirmed_at is not null),
  unique(timesheet_id, work_date)
);

create table if not exists employee_timesheet_day_audits (
  id uuid primary key,
  timesheet_id uuid not null references employee_timesheets(id) on delete restrict,
  timesheet_day_id uuid not null references employee_timesheet_days(id) on delete restrict,
  actor_user_id uuid references user_accounts(id) on delete set null,
  action text not null check (action in ('created','draft_saved','confirmed','corrected')),
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists employee_timesheet_reopenings (
  id uuid primary key,
  timesheet_id uuid not null references employee_timesheets(id) on delete restrict,
  actor_user_id uuid not null references user_accounts(id) on delete restrict,
  reason text not null check (length(trim(reason)) > 0),
  reopened_until timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists employee_timesheet_days_date_idx on employee_timesheet_days(work_date);
create index if not exists employee_timesheet_audits_day_idx on employee_timesheet_day_audits(timesheet_day_id, created_at);

insert into authorization_permissions(id,permission_key,display_name,description,active,created_by,updated_by)
values('00000000-0000-4000-8000-000000002028','manage_timesheets','Manage Timesheets','Review and reopen employee timesheets within the authorized outlet.',true,'migration 024','migration 024')
on conflict(permission_key) do nothing;

insert into authorization_role_permissions(role_id,permission_id,created_by)
select role.id,permission.id,'migration 024'
from authorization_roles role
join authorization_permissions permission on permission.permission_key='manage_timesheets'
where role.role_key='outlet_manager'
on conflict(role_id,permission_id) do nothing;
