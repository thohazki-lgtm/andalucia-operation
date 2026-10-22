do $$
declare andalucia_id uuid;
begin
  select id into andalucia_id from outlet_scopes where scope_key='andalucia' and active=true;
  if andalucia_id is null then
    raise exception 'Migration 019 requires the active canonical Andalucia OutletScope.' using errcode='23514';
  end if;
  if (select count(*) from outlet_scopes where scope_key='andalucia' and active=true)<>1 then
    raise exception 'Migration 019 requires exactly one active canonical Andalucia OutletScope.' using errcode='23514';
  end if;
end $$;

create table if not exists planned_leave_periods (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  staff_id uuid not null references staff(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  leave_type text not null default 'annual_leave' check(leave_type in ('annual_leave')),
  planning_state text not null default 'booked' check(planning_state in ('booked','cancelled')),
  manager_note text,
  revision integer not null default 1 check(revision>=1),
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references user_accounts(id) on delete restrict,
  cancelled_by_name_snapshot text,
  cancellation_reason text,
  created_by_user_id uuid not null references user_accounts(id) on delete restrict,
  created_by_name_snapshot text not null,
  updated_by_user_id uuid not null references user_accounts(id) on delete restrict,
  updated_by_name_snapshot text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planned_leave_date_range_check check(end_date>=start_date),
  constraint planned_leave_note_length_check check(manager_note is null or length(manager_note)<=500),
  constraint planned_leave_cancellation_check check(
    (planning_state='booked' and cancelled_at is null and cancelled_by_user_id is null and cancelled_by_name_snapshot is null)
    or
    (planning_state='cancelled' and cancelled_at is not null and cancelled_by_user_id is not null and length(trim(cancelled_by_name_snapshot))>0)
  )
);

create index if not exists planned_leave_outlet_dates_idx on planned_leave_periods(outlet_scope_id,start_date,end_date);
create index if not exists planned_leave_staff_dates_idx on planned_leave_periods(staff_id,start_date,end_date);
create index if not exists planned_leave_active_dates_idx on planned_leave_periods(outlet_scope_id,staff_id,start_date,end_date) where planning_state='booked';
create unique index if not exists planned_leave_active_exact_period_unique on planned_leave_periods(outlet_scope_id,staff_id,start_date,end_date,leave_type) where planning_state='booked';

create or replace function prevent_active_planned_leave_overlap() returns trigger language plpgsql as $$
begin
  if new.planning_state='booked' and exists(
    select 1 from planned_leave_periods existing
    where existing.id<>new.id
      and existing.outlet_scope_id=new.outlet_scope_id
      and existing.staff_id=new.staff_id
      and existing.planning_state='booked'
      and existing.start_date<=new.end_date
      and new.start_date<=existing.end_date
  ) then
    raise exception 'PLANNED_LEAVE_OVERLAP' using errcode='23514';
  end if;
  return new;
end $$;

drop trigger if exists planned_leave_overlap_guard on planned_leave_periods;
create trigger planned_leave_overlap_guard before insert or update of outlet_scope_id,staff_id,start_date,end_date,planning_state
on planned_leave_periods for each row execute function prevent_active_planned_leave_overlap();
