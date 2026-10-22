create table if not exists staff_annual_leave_service_years (
  id uuid primary key,
  staff_id uuid not null references staff(id) on delete restrict,
  service_year_start date not null,
  service_year_end date not null,
  available_from date not null,
  entitled_units numeric(10,4) not null check (entitled_units >= 0),
  accrual_units_per_completed_month numeric(10,4) not null check (accrual_units_per_completed_month >= 0),
  approved_opening_carry_units numeric(10,4) check (approved_opening_carry_units >= 0),
  opening_carry_effective_date date,
  opening_carry_reason text,
  approved_by_user_id uuid not null references user_accounts(id) on delete restrict,
  approved_by_name_snapshot text not null check (length(trim(approved_by_name_snapshot)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, service_year_start),
  constraint staff_annual_leave_service_year_span check (
    service_year_end = (service_year_start + interval '1 year' - interval '1 day')::date
    or
    (
      extract(month from service_year_start) = 2
      and extract(day from service_year_start) = 28
      and extract(month from service_year_start + interval '1 year' + interval '1 day') = 2
      and extract(day from service_year_start + interval '1 year' + interval '1 day') = 29
      and service_year_end = (service_year_start + interval '1 year')::date
    )
  ),
  constraint staff_annual_leave_service_year_availability check (
    available_from = service_year_end + 1
  ),
  constraint staff_annual_leave_service_year_accrual check (
    (entitled_units = 0 and accrual_units_per_completed_month = 0)
    or
    (entitled_units > 0 and accrual_units_per_completed_month > 0)
  ),
  constraint staff_annual_leave_service_year_opening_evidence check (
    (
      approved_opening_carry_units is null
      and opening_carry_effective_date is null
      and opening_carry_reason is null
    )
    or
    (
      approved_opening_carry_units is not null
      and opening_carry_effective_date is not null
      and opening_carry_effective_date = available_from
      and opening_carry_reason is not null
      and length(trim(opening_carry_reason)) > 0
    )
  )
);

create index if not exists staff_annual_leave_service_years_staff_availability_idx
  on staff_annual_leave_service_years(staff_id, available_from);
