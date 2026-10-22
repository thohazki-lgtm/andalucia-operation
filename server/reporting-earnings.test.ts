import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ReportingRepository } from './reporting-repository.js'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'

const fixture = await createDisposableDevelopmentStore('reporting-earnings')
const db = fixture.db
const staffId = randomUUID()
await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'RPT-1','Reports Seller','Waiter','active','2026-01-01')", [staffId])
const sourceA = randomUUID(); const sourceB = randomUUID(); const ruleId = randomUUID()
for (const [id, date] of [[sourceA, '2026-09-08'], [sourceB, '2026-10-08']] as const) await db.query("insert into chargeable_item_records(id,outlet_scope_id,item_value,item_label,item_category,guest_name,room_number,check_invoice_number,amount,status,charge_date,quantity,unit_price,total_amount,active) values($1,$2,'lobster_paella','Lobster Paella','Food','Reports Guest','701',$4,100,'charged',$3,1,100,100,true)", [id, ANDALUCIA_SCOPE_ID, date, `RPT-${id}`])
await db.query("insert into incentive_rules(id,outlet_scope_id,rule_key,source_key,rule_family,version,effective_from,rate_percent,active) values($1,$2,'food-v1','lobster_paella','food_percentage',1,'2026-01-01',2.5,true)", [ruleId, ANDALUCIA_SCOPE_ID])
const insertEarning = (id: string, sourceId: string, date: string, amount: number, status: string) => db.query("insert into chargeable_incentive_earnings(id,outlet_scope_id,source_chargeable_item_id,seller_id,seller_name_snapshot,seller_number_snapshot,designation_snapshot,service_date,package_identity,quantity,guest_amount,eligible_net_amount,incentive_rule_id,incentive_rule_version,rule_family_snapshot,applied_rate_percent,calculated_amount,final_amount,status,generation_key) values($1,$2,$3,$4,'Reports Seller','RPT-1','Waiter',$5,'lobster_paella',1,100,80,$6,1,'food_percentage',2.5,$7,$7,$8,$9)", [id, ANDALUCIA_SCOPE_ID, sourceId, staffId, date, ruleId, amount, status, `earning:${id}`])
await insertEarning(randomUUID(), sourceA, '2026-09-08', 2, 'finalized')
await insertEarning(randomUUID(), sourceB, '2026-10-08', 3, 'draft')
const septemberRevision = randomUUID(); const octoberRevision = randomUUID()
await db.query("insert into staff_membership_baseline_reviews(id,outlet_scope_id,baseline_month,status,is_authoritative,approved_at,approved_by,approved_by_user_id,created_by,updated_by) values($1,$2,'2026-09','approved',true,now(),'Reports fixture',$3,'Reports fixture','Reports fixture'),($4,$2,'2026-10','approved',true,now(),'Reports fixture',$3,'Reports fixture','Reports fixture')", [septemberRevision, ANDALUCIA_SCOPE_ID, fixture.ownerId, octoberRevision])
await db.query("insert into bill_tip_distributions(id,outlet_scope_id,team_membership_revision_id,distribution_month,pool_amount,status,finalized_at,finalized_by_user_id,finalized_by_name) values($1,$2,$3,'2026-09',100,'finalized',now(),$4,'Reports fixture')", [randomUUID(), ANDALUCIA_SCOPE_ID, septemberRevision, fixture.ownerId])
await db.query("insert into bill_tip_distributions(id,outlet_scope_id,team_membership_revision_id,distribution_month,pool_amount,status) values($1,$2,$3,'2026-10',120,'draft')", [randomUUID(), ANDALUCIA_SCOPE_ID, octoberRevision])

const report = await new ReportingRepository(db).report('custom', '2026-09-01', '2026-10-31')
assert.deepEqual(report.earnings, {
  incentives: { finalizedAmount: 2, provisionalAmount: 3, finalizedRecords: 1, provisionalRecords: 1 },
  billTips: { finalizedAmount: 100, provisionalAmount: 120, finalizedMonths: 1, provisionalMonths: 1 },
  state: 'provisional'
})
await fixture.cleanup()
console.log('Reports financial status separation: PASS')
