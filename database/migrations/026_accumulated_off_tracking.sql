do $$
declare andalucia_id uuid;
begin
  select id into andalucia_id from outlet_scopes where scope_key='andalucia' and active=true;
  if andalucia_id is null or (select count(*) from outlet_scopes where scope_key='andalucia' and active=true)<>1 then
    raise exception 'Migration 026 requires exactly one active canonical Andalucia OutletScope.' using errcode='23514';
  end if;
  if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='planned_leave_periods') then
    raise exception 'Migration 026 requires Migration 019 planned leave.' using errcode='23514';
  end if;
end $$;

alter table planned_leave_periods
  add column if not exists accumulated_off_days_allocated integer not null default 0;

alter table planned_leave_periods drop constraint if exists planned_leave_accumulated_off_check;
alter table planned_leave_periods add constraint planned_leave_accumulated_off_check check(
  accumulated_off_days_allocated>=0
  and accumulated_off_days_allocated<=((end_date-start_date)+1)
);

create table if not exists accumulated_off_week_evaluations (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  staff_id uuid not null references staff(id) on delete restrict,
  membership_id uuid references staff_membership_history(id) on delete restrict,
  week_start date not null,
  week_end date not null,
  evaluation_state text not null check(evaluation_state in ('earned','not_earned','incomplete','ineligible')),
  earned_days integer not null check(earned_days in (0,1)),
  assignment_count integer not null check(assignment_count between 0 and 7),
  working_count integer not null check(working_count between 0 and 7),
  off_count integer not null check(off_count between 0 and 7),
  evidence jsonb not null default '{}'::jsonb,
  evidence_digest text not null,
  revision integer not null default 1 check(revision>=1),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accumulated_off_week_range_check check(
    week_end=week_start+6 and extract(dow from week_start)=0 and week_start>='2026-09-06'::date
  ),
  unique(outlet_scope_id,staff_id,week_start)
);

create index if not exists accumulated_off_week_staff_idx on accumulated_off_week_evaluations(outlet_scope_id,staff_id,week_start);

create table if not exists accumulated_off_opening_entries (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  staff_id uuid not null references staff(id) on delete restrict,
  days integer not null check(days>0),
  effective_date date not null check(effective_date<'2026-09-06'::date),
  justification text not null check(length(trim(justification))>=10),
  evidence_reference text not null check(length(trim(evidence_reference))>=3),
  created_by_user_id uuid not null references user_accounts(id) on delete restrict,
  created_by_name_snapshot text not null,
  created_at timestamptz not null default now()
);

create index if not exists accumulated_off_opening_staff_idx on accumulated_off_opening_entries(outlet_scope_id,staff_id,effective_date);

create table if not exists accumulated_off_consumptions (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  staff_id uuid not null references staff(id) on delete restrict,
  planned_leave_period_id uuid not null references planned_leave_periods(id) on delete restrict,
  roster_entry_id uuid not null,
  duty_date date not null,
  duty_code_value text not null,
  evidence jsonb not null default '{}'::jsonb,
  confirmed_by_user_id uuid not null references user_accounts(id) on delete restrict,
  confirmed_by_name_snapshot text not null,
  confirmed_at timestamptz not null default now(),
  unique(planned_leave_period_id,duty_date),
  unique(outlet_scope_id,staff_id,roster_entry_id)
);

create index if not exists accumulated_off_consumption_staff_idx on accumulated_off_consumptions(outlet_scope_id,staff_id,duty_date);
