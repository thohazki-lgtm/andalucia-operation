alter table chargeable_item_records
  add column if not exists check_invoice_number text not null default '';

-- Existing historical charged records are deliberately preserved without
-- fabricated proof references. PostgreSQL still enforces this NOT VALID
-- constraint for every new or subsequently edited row.
alter table chargeable_item_records
  add constraint chargeable_realized_financial_proof_check check(
    status <> 'charged'
    or (length(trim(coalesce(room_number,''))) > 0 and length(trim(check_invoice_number)) > 0)
  ) not valid;

create index if not exists chargeable_check_invoice_search_idx
  on chargeable_item_records(outlet_scope_id,check_invoice_number)
  where check_invoice_number <> '';

create table if not exists wine_spirit_sales (
  id uuid primary key,
  outlet_scope_id uuid not null references outlet_scopes(id) on delete restrict,
  service_date date not null,
  check_invoice_number text not null check(length(trim(check_invoice_number)) > 0),
  item_name text not null check(length(trim(item_name)) > 0),
  room_number text not null check(length(trim(room_number)) > 0),
  table_number text not null check(length(trim(table_number)) > 0),
  waiter_id uuid not null references staff(id) on delete restrict,
  gross_unit_price numeric(14,2) not null check(gross_unit_price > 0),
  financial_rate_version_id uuid not null references financial_rate_versions(id) on delete restrict,
  service_charge_rate numeric(9,4) not null check(service_charge_rate >= 0),
  gst_rate numeric(9,4) not null check(gst_rate >= 0),
  incentive_eligible_net_unit_price numeric(14,2) not null check(incentive_eligible_net_unit_price > 0),
  incentive_rule_id uuid not null references incentive_rules(id) on delete restrict,
  incentive_rule_version integer not null check(incentive_rule_version >= 1),
  incentive_tier_minimum numeric(14,2) not null check(incentive_tier_minimum >= 0),
  incentive_tier_maximum numeric(14,2) check(incentive_tier_maximum is null or incentive_tier_maximum >= incentive_tier_minimum),
  incentive_reward_mode text not null check(incentive_reward_mode in ('none','fixed','percentage')),
  incentive_reward_value numeric(14,4) not null check(incentive_reward_value >= 0),
  incentive_per_bottle numeric(14,2) not null check(incentive_per_bottle >= 0),
  quantity integer not null default 1 check(quantity >= 1),
  gross_total numeric(14,2) generated always as (round(gross_unit_price * quantity, 2)) stored,
  incentive_eligible_net_total numeric(14,2) generated always as (round(incentive_eligible_net_unit_price * quantity, 2)) stored,
  total_beverage_incentive numeric(14,2) generated always as (round(incentive_per_bottle * quantity, 2)) stored,
  status text not null default 'pending' check(status in ('pending','charged','cancelled','void')),
  notes text not null default '',
  archived_at timestamptz,
  archived_by_user_id uuid references user_accounts(id) on delete restrict,
  archived_by_name text,
  created_by_user_id uuid not null references user_accounts(id) on delete restrict,
  created_by_name text not null check(length(trim(created_by_name)) > 0),
  updated_by_user_id uuid not null references user_accounts(id) on delete restrict,
  updated_by_name text not null check(length(trim(updated_by_name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wine_spirit_archive_identity_check check(
    (archived_at is null and archived_by_user_id is null and archived_by_name is null)
    or
    (archived_at is not null and archived_by_user_id is not null and length(trim(archived_by_name)) > 0)
  ),
  constraint wine_spirit_charged_evidence_check check(status <> 'charged' or archived_at is null)
);

create unique index if not exists wine_spirit_sale_outlet_identity on wine_spirit_sales(id,outlet_scope_id);
create index if not exists wine_spirit_sale_service_date_idx on wine_spirit_sales(outlet_scope_id,service_date desc,created_at desc);
create index if not exists wine_spirit_sale_check_invoice_idx on wine_spirit_sales(outlet_scope_id,check_invoice_number,service_date desc);
create index if not exists wine_spirit_sale_waiter_idx on wine_spirit_sales(outlet_scope_id,waiter_id,service_date desc);
create index if not exists wine_spirit_sale_status_idx on wine_spirit_sales(outlet_scope_id,status,service_date desc) where archived_at is null;

-- Deliberately non-unique: multiple items and multiple bottles on one signed
-- check can be legitimate. This complete evidence tuple supports a warning
-- and manager review without blocking an authoritative transaction.
create index if not exists wine_spirit_sale_duplicate_review_idx
  on wine_spirit_sales(outlet_scope_id,service_date,room_number,check_invoice_number,item_name,waiter_id,gross_unit_price,quantity,table_number)
  where archived_at is null and status <> 'void';

create or replace function protect_wine_spirit_sale_deletion() returns trigger language plpgsql as $$
begin
  raise exception 'Wine/Spirits financial evidence cannot be deleted. Archive or void the record through the audited workflow.' using errcode='23514';
end $$;

drop trigger if exists wine_spirit_sale_no_delete on wine_spirit_sales;
create trigger wine_spirit_sale_no_delete before delete on wine_spirit_sales for each row execute function protect_wine_spirit_sale_deletion();
