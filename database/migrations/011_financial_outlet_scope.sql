alter table chargeable_item_records add column if not exists outlet_scope_id uuid;
alter table bill_tip_distributions add column if not exists outlet_scope_id uuid;
alter table bill_tip_distributions add column if not exists team_membership_revision_id uuid;
alter table incentive_rules add column if not exists outlet_scope_id uuid;
alter table financial_rate_versions add column if not exists outlet_scope_id uuid;
alter table chargeable_incentive_earnings add column if not exists outlet_scope_id uuid;

update chargeable_item_records record
set outlet_scope_id=scope.id
from outlet_scopes scope
where record.outlet_scope_id is null and scope.scope_key='andalucia';

update bill_tip_distributions distribution
set outlet_scope_id=scope.id
from outlet_scopes scope
where distribution.outlet_scope_id is null and scope.scope_key='andalucia';

update incentive_rules rule
set outlet_scope_id=scope.id
from outlet_scopes scope
where rule.outlet_scope_id is null and scope.scope_key='andalucia';

update financial_rate_versions rate
set outlet_scope_id=scope.id
from outlet_scopes scope
where rate.outlet_scope_id is null and scope.scope_key='andalucia';

update chargeable_incentive_earnings earning
set outlet_scope_id=scope.id
from outlet_scopes scope
where earning.outlet_scope_id is null and scope.scope_key='andalucia';

do $$
begin
  if exists(select 1 from chargeable_item_records where outlet_scope_id is null)
    or exists(select 1 from incentive_rules where outlet_scope_id is null)
    or exists(select 1 from financial_rate_versions where outlet_scope_id is null)
    or exists(select 1 from chargeable_incentive_earnings where outlet_scope_id is null)
    or exists(select 1 from bill_tip_distributions where outlet_scope_id is null)
  then
    raise exception 'Financial records could not be assigned to the Andalucía OutletScope.' using errcode='23514';
  end if;

  if exists(select 1 from bill_tip_distributions where team_membership_revision_id is null)
  then
    raise exception 'Existing Bill Tip drafts require an explicit approved Team Membership revision before migration.' using errcode='23514';
  end if;
end $$;

alter table chargeable_item_records alter column outlet_scope_id set not null;
alter table bill_tip_distributions alter column outlet_scope_id set not null;
alter table bill_tip_distributions alter column team_membership_revision_id set not null;
alter table incentive_rules alter column outlet_scope_id set not null;
alter table financial_rate_versions alter column outlet_scope_id set not null;
alter table chargeable_incentive_earnings alter column outlet_scope_id set not null;

alter table chargeable_item_records
  add constraint chargeable_item_outlet_scope_fk foreign key(outlet_scope_id) references outlet_scopes(id) on delete restrict;
alter table bill_tip_distributions
  add constraint bill_tip_distribution_outlet_scope_fk foreign key(outlet_scope_id) references outlet_scopes(id) on delete restrict;
alter table incentive_rules
  add constraint incentive_rule_outlet_scope_fk foreign key(outlet_scope_id) references outlet_scopes(id) on delete restrict;
alter table financial_rate_versions
  add constraint financial_rate_outlet_scope_fk foreign key(outlet_scope_id) references outlet_scopes(id) on delete restrict;
alter table chargeable_incentive_earnings
  add constraint chargeable_incentive_outlet_scope_fk foreign key(outlet_scope_id) references outlet_scopes(id) on delete restrict;

create unique index staff_membership_baseline_review_outlet_identity
  on staff_membership_baseline_reviews(id,outlet_scope_id);
alter table bill_tip_distributions
  add constraint bill_tip_membership_revision_outlet_fk
  foreign key(team_membership_revision_id,outlet_scope_id)
  references staff_membership_baseline_reviews(id,outlet_scope_id) on delete restrict;

create unique index chargeable_item_outlet_identity
  on chargeable_item_records(id,outlet_scope_id);
alter table chargeable_incentive_earnings
  add constraint chargeable_incentive_source_outlet_fk
  foreign key(source_chargeable_item_id,outlet_scope_id)
  references chargeable_item_records(id,outlet_scope_id) on delete restrict;

create unique index incentive_rule_outlet_identity on incentive_rules(id,outlet_scope_id);
alter table chargeable_incentive_earnings
  add constraint chargeable_incentive_rule_outlet_fk
  foreign key(incentive_rule_id,outlet_scope_id)
  references incentive_rules(id,outlet_scope_id) on delete restrict;

create unique index financial_rate_outlet_identity on financial_rate_versions(id,outlet_scope_id);
alter table chargeable_incentive_earnings
  add constraint chargeable_incentive_rate_outlet_fk
  foreign key(financial_rate_version_id,outlet_scope_id)
  references financial_rate_versions(id,outlet_scope_id) on delete restrict;

alter table bill_tip_distributions drop constraint if exists bill_tip_distributions_distribution_month_key;
drop index if exists bill_tip_distribution_status_idx;
create unique index bill_tip_distribution_outlet_month_unique
  on bill_tip_distributions(outlet_scope_id,distribution_month);
create index bill_tip_distribution_status_idx
  on bill_tip_distributions(outlet_scope_id,status,distribution_month);

alter table incentive_rules drop constraint if exists incentive_rules_rule_key_version_key;
drop index if exists incentive_rule_one_active_version;
create unique index incentive_rule_outlet_key_version_unique
  on incentive_rules(outlet_scope_id,rule_key,version);
create unique index incentive_rule_one_active_version
  on incentive_rules(outlet_scope_id,rule_key) where active=true;

alter table financial_rate_versions drop constraint if exists financial_rate_versions_version_key;
drop index if exists financial_rate_one_active_version;
create unique index financial_rate_outlet_version_unique
  on financial_rate_versions(outlet_scope_id,version);
create unique index financial_rate_one_active_version
  on financial_rate_versions(outlet_scope_id) where active=true;

alter table chargeable_incentive_earnings drop constraint if exists chargeable_incentive_earnings_generation_key_key;
drop index if exists chargeable_incentive_one_current_per_sale;
create unique index chargeable_incentive_outlet_generation_unique
  on chargeable_incentive_earnings(outlet_scope_id,generation_key);
create unique index chargeable_incentive_one_current_per_sale
  on chargeable_incentive_earnings(outlet_scope_id,source_chargeable_item_id)
  where status in ('draft','finalized');

