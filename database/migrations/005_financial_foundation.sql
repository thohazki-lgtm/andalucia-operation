create table if not exists bill_tip_distributions (
  id uuid primary key, distribution_month text not null check (distribution_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  pool_amount numeric(14,2) not null default 0 check (pool_amount >= 0), status text not null default 'draft' check (status in ('draft','finalized')),
  undistributed_remainder numeric(14,2) not null default 0 check (undistributed_remainder >= 0),
  external_allocation_total numeric(14,2) not null default 0 check (external_allocation_total >= 0),
  remaining_team_pool numeric(14,2) not null default 0 check (remaining_team_pool >= 0),
  total_eligible_days integer not null default 0 check (total_eligible_days >= 0), eligible_staff_count integer not null default 0 check (eligible_staff_count >= 0),
  value_per_eligible_day numeric(14,6) not null default 0 check (value_per_eligible_day >= 0),
  policy_version text not null default 'bill-tip-v1', policy_metadata jsonb not null default '{}', calculated_at timestamptz, calculated_by text,
  finalized_at timestamptz, finalized_by text, reopened_at timestamptz, reopened_by text, reopen_reason text,
  created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(distribution_month)
);
create index if not exists bill_tip_distribution_status_idx on bill_tip_distributions(status,distribution_month);
create table if not exists bill_tip_staff_allocations (
  id uuid primary key, distribution_id uuid not null references bill_tip_distributions(id) on delete restrict,
  staff_id uuid not null references staff(id) on delete restrict, staff_name_snapshot text not null, staff_number_snapshot text not null,
  designation_snapshot text not null, eligible_days integer not null default 0 check (eligible_days >= 0),
  excluded_al_days integer not null default 0 check (excluded_al_days >= 0), missing_roster_days integer not null default 0 check (missing_roster_days >= 0),
  requires_roster_review boolean not null default false, value_per_eligible_day numeric(14,6) not null default 0 check (value_per_eligible_day >= 0),
  calculated_amount numeric(14,6) not null default 0 check (calculated_amount >= 0), final_amount numeric(14,2) not null default 0 check (final_amount >= 0),
  created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(distribution_id,staff_id)
);
create table if not exists bill_tip_manual_allocations (
  id uuid primary key, distribution_id uuid not null references bill_tip_distributions(id) on delete restrict,
  linked_staff_id uuid references staff(id) on delete restrict, helper_name text not null, staff_reference text, department text, outlet text,
  fixed_amount numeric(14,2) not null check (fixed_amount >= 0), reason text not null, notes text not null default '', idempotency_key text,
  created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists bill_tip_manual_allocation_retry_unique on bill_tip_manual_allocations(distribution_id,idempotency_key) where idempotency_key is not null;
create table if not exists incentive_rules (
  id uuid primary key, rule_key text not null, configuration_option_id uuid references configuration_options(id) on delete restrict,
  source_key text not null, rule_family text not null check (rule_family in ('no_incentive','food_percentage','wine_spirits_tier')),
  version integer not null check (version >= 1), effective_from date not null, effective_to date, rate_percent numeric(9,4), active boolean not null default true,
  created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from), check (rate_percent is null or rate_percent >= 0), unique(rule_key,version)
);
create unique index if not exists incentive_rule_one_active_version on incentive_rules(rule_key) where active=true;
create table if not exists incentive_rule_tiers (
  id uuid primary key, rule_id uuid not null references incentive_rules(id) on delete restrict,
  minimum_amount numeric(14,2) not null check (minimum_amount >= 0), maximum_amount numeric(14,2),
  reward_mode text not null check (reward_mode in ('none','fixed','percentage')), reward_value numeric(14,4) not null default 0 check (reward_value >= 0),
  sort_order integer not null, check (maximum_amount is null or maximum_amount >= minimum_amount), unique(rule_id,sort_order)
);
create table if not exists financial_rate_versions (
  id uuid primary key, version integer not null unique check (version >= 1), effective_from date not null, effective_to date,
  service_charge_rate numeric(9,4) not null check (service_charge_rate >= 0), gst_rate numeric(9,4) not null check (gst_rate >= 0),
  active boolean not null default true, created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists financial_rate_one_active_version on financial_rate_versions((true)) where active=true;
create index if not exists financial_rate_effective_date_idx on financial_rate_versions(effective_from,effective_to);
create table if not exists chargeable_incentive_earnings (
  id uuid primary key, source_chargeable_item_id uuid not null references chargeable_item_records(id) on delete restrict,
  seller_id uuid not null references staff(id) on delete restrict, seller_name_snapshot text not null, seller_number_snapshot text not null,
  designation_snapshot text not null, service_date date not null, package_identity text not null, quantity integer not null check (quantity >= 1),
  guest_amount numeric(14,2) not null check (guest_amount >= 0), eligible_net_amount numeric(14,2) not null check (eligible_net_amount >= 0),
  incentive_rule_id uuid not null references incentive_rules(id) on delete restrict, incentive_rule_version integer not null check (incentive_rule_version >= 1),
  rule_family_snapshot text not null check (rule_family_snapshot in ('no_incentive','food_percentage','wine_spirits_tier')),
  applied_rate_percent numeric(9,4), applied_fixed_amount numeric(14,4), applied_tier_minimum numeric(14,2), applied_tier_maximum numeric(14,2),
  calculated_amount numeric(14,6) not null check (calculated_amount >= 0), final_amount numeric(14,2) not null check (final_amount >= 0),
  status text not null default 'draft' check (status in ('draft','finalized','reversed')), generation_key text not null unique,
  reversal_of_id uuid references chargeable_incentive_earnings(id) on delete restrict,
  financial_rate_version_id uuid references financial_rate_versions(id) on delete restrict,
  financial_rate_version integer check (financial_rate_version is null or financial_rate_version >= 1),
  service_charge_rate numeric(9,4) check (service_charge_rate is null or service_charge_rate >= 0),
  gst_rate numeric(9,4) check (gst_rate is null or gst_rate >= 0), finalized_at timestamptz, finalized_by text,
  created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists chargeable_incentive_one_current_per_sale on chargeable_incentive_earnings(source_chargeable_item_id) where status in ('draft','finalized');
create unique index if not exists chargeable_incentive_one_reversal on chargeable_incentive_earnings(reversal_of_id) where reversal_of_id is not null;
