create table if not exists staff_leave_entitlement_years (
  id uuid primary key,
  staff_id uuid not null references staff(id) on delete restrict,
  entitlement_year integer not null check (entitlement_year between 1900 and 2200),
  leave_classification text not null check (
    leave_classification in (
      'annualLeave',
      'sickLeave',
      'emergencyLeave',
      'paternityLeave',
      'businessTrip',
      'circumcisionLeave',
      'hajjLeave',
      'restAndRecuperation',
      'publicHoliday'
    )
  ),
  entitled_units numeric(10,4) not null check (entitled_units >= 0),
  accrual_units_per_completed_month numeric(10,4),
  eligible_from date,
  eligible_through date,
  opening_balance_adjustment_units numeric(10,4),
  opening_balance_reason text,
  approved_by_user_id uuid not null references user_accounts(id) on delete restrict,
  approved_by_name_snapshot text not null check (length(trim(approved_by_name_snapshot)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, entitlement_year, leave_classification),
  constraint staff_leave_entitlement_year_date_range check (
    eligible_through is null or eligible_from is null or eligible_through >= eligible_from
  ),
  constraint staff_leave_entitlement_year_bounds check (
    (eligible_from is null or extract(year from eligible_from)::integer = entitlement_year)
    and (eligible_through is null or extract(year from eligible_through)::integer = entitlement_year)
  ),
  constraint staff_leave_entitlement_year_opening_evidence check (
    (opening_balance_adjustment_units is null and opening_balance_reason is null)
    or
    (opening_balance_adjustment_units is not null and length(trim(opening_balance_reason)) > 0)
  ),
  constraint staff_leave_entitlement_year_classification_rules check (
    (
      leave_classification = 'annualLeave'
      and accrual_units_per_completed_month is not null
      and accrual_units_per_completed_month >= 0
      and eligible_from is not null
      and (
        (entitled_units = 0 and accrual_units_per_completed_month = 0)
        or
        (entitled_units > 0 and accrual_units_per_completed_month > 0)
      )
    )
    or
    (
      leave_classification <> 'annualLeave'
      and accrual_units_per_completed_month is null
      and eligible_from is null
      and eligible_through is null
      and opening_balance_adjustment_units is null
      and opening_balance_reason is null
    )
  )
);

create index if not exists staff_leave_entitlement_years_staff_year_idx
  on staff_leave_entitlement_years(staff_id, entitlement_year);
