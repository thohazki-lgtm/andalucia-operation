create table if not exists staff_leave_entitlement_overrides (
  id uuid primary key,
  staff_id uuid not null references staff(id) on delete restrict,
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
      'off',
      'publicHoliday'
    )
  ),
  entitled_units integer not null check (entitled_units >= 0),
  created_by text not null check (length(trim(created_by)) > 0),
  updated_by text not null check (length(trim(updated_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, leave_classification)
);

create index if not exists staff_leave_entitlement_overrides_staff_idx
  on staff_leave_entitlement_overrides(staff_id);
