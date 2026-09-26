import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { runMigrations } from './migration-store.js'

const db = new PGlite()
await db.exec(await readFile('database/schema.sql', 'utf8'))

const chargeableId = randomUUID()
const ruleId = randomUUID()
const rateId = randomUUID()
await db.query("insert into chargeable_item_records(id,item_value,item_label,item_category,charge_date,guest_name,amount,unit_price,total_amount,status) values($1,'lobster-paella','Lobster Paella','Food','2026-09-01','Isolated Guest',85,85,85,'charged')", [chargeableId])
await db.query("insert into incentive_rules(id,rule_key,source_key,rule_family,version,effective_from,rate_percent) values($1,'food','lobster-paella','food_percentage',1,'2026-01-01',2.5)", [ruleId])
await db.query("insert into financial_rate_versions(id,version,effective_from,service_charge_rate,gst_rate) values($1,1,'2026-01-01',10,17)", [rateId])

const result = await runMigrations(db)
assert.deepEqual(result.applied, ['001', '002', '003', '004', '005', '006', '007', '008', '009', '010', '011', '012', '013', '014', '015', '016', '017'])

for (const table of ['chargeable_item_records', 'bill_tip_distributions', 'incentive_rules', 'financial_rate_versions', 'chargeable_incentive_earnings']) {
  const column = (await db.query<{ is_nullable: string }>("select is_nullable from information_schema.columns where table_schema='public' and table_name=$1 and column_name='outlet_scope_id'", [table])).rows[0]
  assert.equal(column?.is_nullable, 'NO', `${table} must require OutletScope authority`)
}
assert.equal((await db.query<{ outlet_scope_id: string }>('select outlet_scope_id from chargeable_item_records where id=$1', [chargeableId])).rows[0]?.outlet_scope_id, ANDALUCIA_SCOPE_ID)
assert.equal((await db.query<{ outlet_scope_id: string }>('select outlet_scope_id from incentive_rules where id=$1', [ruleId])).rows[0]?.outlet_scope_id, ANDALUCIA_SCOPE_ID)
assert.equal((await db.query<{ outlet_scope_id: string }>('select outlet_scope_id from financial_rate_versions where id=$1', [rateId])).rows[0]?.outlet_scope_id, ANDALUCIA_SCOPE_ID)

const secondOutletId = randomUUID()
const ownerId = randomUUID()
await db.query("insert into outlet_scopes(id,scope_key,display_name,active) values($1,'isolated_test_outlet','Isolated Test Outlet',true)", [secondOutletId])
await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'isolated-owner','isolated-owner','Isolated Owner','hash','active')", [ownerId])

const reviewOne = randomUUID()
const reviewTwo = randomUUID()
await db.query("insert into staff_membership_baseline_reviews(id,outlet_scope_id,baseline_month,status,revision_number,review_type,is_current_revision,is_authoritative,approved_at,approved_by,approved_by_user_id) values($1,$2,'2026-09','approved',1,'initial',true,true,now(),'Isolated Owner',$3)", [reviewOne, ANDALUCIA_SCOPE_ID, ownerId])
await db.query("insert into staff_membership_baseline_reviews(id,outlet_scope_id,baseline_month,status,revision_number,review_type,is_current_revision,is_authoritative,approved_at,approved_by,approved_by_user_id) values($1,$2,'2026-09','approved',1,'initial',true,true,now(),'Isolated Owner',$3)", [reviewTwo, secondOutletId, ownerId])

await db.query("insert into bill_tip_distributions(id,outlet_scope_id,team_membership_revision_id,distribution_month,pool_amount) values($1,$2,$3,'2026-09',100)", [randomUUID(), ANDALUCIA_SCOPE_ID, reviewOne])
await db.query("insert into bill_tip_distributions(id,outlet_scope_id,team_membership_revision_id,distribution_month,pool_amount) values($1,$2,$3,'2026-09',100)", [randomUUID(), secondOutletId, reviewTwo])
await assert.rejects(db.query("insert into bill_tip_distributions(id,outlet_scope_id,team_membership_revision_id,distribution_month,pool_amount) values($1,$2,$3,'2026-09',100)", [randomUUID(), ANDALUCIA_SCOPE_ID, reviewOne]), /duplicate key/)
await assert.rejects(db.query("insert into bill_tip_distributions(id,outlet_scope_id,team_membership_revision_id,distribution_month,pool_amount) values($1,$2,$3,'2026-10',100)", [randomUUID(), secondOutletId, reviewOne]), /foreign key/)

await db.query("insert into incentive_rules(id,outlet_scope_id,rule_key,source_key,rule_family,version,effective_from,rate_percent) values($1,$2,'food','lobster-paella','food_percentage',1,'2026-01-01',2.5)", [randomUUID(), secondOutletId])
await db.query("insert into financial_rate_versions(id,outlet_scope_id,version,effective_from,service_charge_rate,gst_rate) values($1,$2,1,'2026-01-01',10,17)", [randomUUID(), secondOutletId])

const indexes = new Set((await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname='public'")).rows.map(row => row.indexname))
for (const name of ['bill_tip_distribution_version_unique', 'bill_tip_distribution_current_finalized_unique', 'incentive_rule_outlet_key_version_unique', 'financial_rate_outlet_version_unique', 'chargeable_incentive_outlet_generation_unique']) assert(indexes.has(name), `${name} is required`)

console.log(JSON.stringify({
  migration: '001–017',
  existingAndaluciaRecordsBackfilled: true,
  outletColumnsRequired: true,
  billTipRevisionSnapshotRequired: true,
  crossOutletRevisionRejected: true,
  samePeriodAcrossDifferentOutletsAllowed: true,
  scopedRuleAndRateVersionsAllowed: true,
}, null, 2))
await db.close()
