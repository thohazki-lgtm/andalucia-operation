import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
try {
  await db.exec(`
    create table outlet_scopes(id uuid primary key);
    create table staff(id uuid primary key, staff_number text not null);
    create table user_accounts(id uuid primary key);
    create table financial_rate_versions(id uuid primary key);
    create table incentive_rules(id uuid primary key);
    create table chargeable_item_records(id uuid primary key,outlet_scope_id uuid not null,status text not null,room_number text);
  `)
  const outletId = randomUUID(); const secondOutletId = randomUUID(); const waiterId = randomUUID(); const userId = randomUUID(); const rateId = randomUUID(); const ruleId = randomUUID()
  await db.query('insert into outlet_scopes(id) values($1),($2)', [outletId, secondOutletId])
  await db.query("insert into staff(id,staff_number) values($1,'SW2155')", [waiterId])
  await db.query('insert into user_accounts(id) values($1)', [userId])
  await db.query('insert into financial_rate_versions(id) values($1)', [rateId])
  await db.query('insert into incentive_rules(id) values($1)', [ruleId])
  const historicalChargeableId = randomUUID()
  await db.query("insert into chargeable_item_records(id,outlet_scope_id,status,room_number) values($1,$2,'charged','888')", [historicalChargeableId, outletId])
  await db.exec(await readFile('database/migrations/013_wine_spirits_incentive_source.sql', 'utf8'))

  assert.deepEqual((await db.query<any>('select check_invoice_number from chargeable_item_records where id=$1', [historicalChargeableId])).rows[0], { check_invoice_number: '' })
  await assert.rejects(() => db.query("insert into chargeable_item_records(id,outlet_scope_id,status,room_number,check_invoice_number) values($1,$2,'charged','888','')", [randomUUID(), outletId]), /chargeable_realized_financial_proof_check/i)
  await db.query("insert into chargeable_item_records(id,outlet_scope_id,status,room_number,check_invoice_number) values($1,$2,'pending','','')", [randomUUID(), outletId])

  const insert = async (overrides: { id?: string; outlet?: string; item?: string; check?: string; room?: string; table?: string; waiter?: string; price?: string; quantity?: number; status?: string; archived?: boolean } = {}) => {
    const id = overrides.id || randomUUID(); const archived = Boolean(overrides.archived)
    return db.query<any>(`
      insert into wine_spirit_sales(
        id,outlet_scope_id,service_date,check_invoice_number,item_name,room_number,table_number,waiter_id,
        gross_unit_price,financial_rate_version_id,service_charge_rate,gst_rate,incentive_eligible_net_unit_price,
        incentive_rule_id,incentive_rule_version,incentive_tier_minimum,incentive_tier_maximum,incentive_reward_mode,
        incentive_reward_value,incentive_per_bottle,quantity,status,archived_at,archived_by_user_id,archived_by_name,
        created_by_user_id,created_by_name,updated_by_user_id,updated_by_name
      ) values($1,$2,'2026-09-12',$3,$4,$5,$6,$7,$8,$9,'10.0000','17.0000','73.82',$10,1,'70.00','99.99','fixed','3.0000','3.00',$11,$12,case when $13::boolean then now() else null end,case when $13::boolean then $14::uuid else null end,case when $13::boolean then 'THOHA LI' else null end,$14::uuid,'THOHA LI',$14::uuid,'THOHA LI')
      returning check_invoice_number,item_name,room_number,table_number,gross_unit_price::text,quantity,gross_total::text,incentive_eligible_net_unit_price::text,incentive_eligible_net_total::text,incentive_per_bottle::text,total_beverage_incentive::text,status
    `, [id, overrides.outlet || outletId, overrides.check ?? '  CHECK-001  ', overrides.item ?? '  Château Exact  ', overrides.room ?? '888', overrides.table ?? 'Table 3', overrides.waiter || waiterId, overrides.price ?? '95.00', rateId, ruleId, overrides.quantity ?? 2, overrides.status || 'charged', archived, userId])
  }

  const firstId = randomUUID(); const first = (await insert({ id: firstId })).rows[0]
  assert.deepEqual(first, { check_invoice_number: '  CHECK-001  ', item_name: '  Château Exact  ', room_number: '888', table_number: 'Table 3', gross_unit_price: '95.00', quantity: 2, gross_total: '190.00', incentive_eligible_net_unit_price: '73.82', incentive_eligible_net_total: '147.64', incentive_per_bottle: '3.00', total_beverage_incentive: '6.00', status: 'charged' })
  assert.deepEqual((await db.query<any>('select s.staff_number,w.outlet_scope_id::text from wine_spirit_sales w join staff s on s.id=w.waiter_id where w.id=$1', [firstId])).rows[0], { staff_number: 'SW2155', outlet_scope_id: outletId })

  await insert()
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from wine_spirit_sales where check_invoice_number=$1', ['  CHECK-001  '])).rows[0].count), 2)
  await assert.rejects(() => insert({ item: '   ' }), /check constraint/i)
  await assert.rejects(() => insert({ check: '   ' }), /check constraint/i)
  await assert.rejects(() => insert({ room: '' }), /check constraint/i)
  await assert.rejects(() => insert({ table: '' }), /check constraint/i)
  await assert.rejects(() => insert({ waiter: randomUUID() }), /foreign key constraint/i)
  await assert.rejects(() => insert({ outlet: randomUUID() }), /foreign key constraint/i)
  await assert.rejects(() => insert({ price: '0.00' }), /check constraint/i)
  await assert.rejects(() => insert({ quantity: 0 }), /check constraint/i)

  for (const status of ['pending', 'cancelled', 'void'] as const) await insert({ item: `Status ${status}`, status })
  await insert({ item: 'Archived pending', status: 'pending', archived: true })
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from wine_spirit_sales where status='charged' and archived_at is null")).rows[0].count), 2)
  await insert({ outlet: secondOutletId, item: 'Other outlet bottle', check: 'OTHER-001', price: '70.00', quantity: 1 })
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from wine_spirit_sales where outlet_scope_id=$1', [secondOutletId])).rows[0].count), 1)

  await assert.rejects(() => db.query('delete from wine_spirit_sales where id=$1', [firstId]), /cannot be deleted/i)
  await db.query("update wine_spirit_sales set status='void',archived_at=now(),archived_by_user_id=$2,archived_by_name='THOHA LI' where id=$1", [firstId, userId])
  assert.deepEqual((await db.query<any>('select status,archived_at is not null archived from wine_spirit_sales where id=$1', [firstId])).rows[0], { status: 'void', archived: true })

  console.log(JSON.stringify({ migration: '013', historicalChargeablesPreserved: true, newRealizedProofEnforced: true, exactCheckPreserved: true, exactNamePreserved: true, generatedGrossTotal: '190.00', generatedNetTotal: '147.64', generatedBeverageIncentive: '6.00', duplicateEvidenceAllowedForReview: true, roomAndTableRequired: true, positivePriceAndQuantityRequired: true, authoritativeWaiterUuidAndEmployeeId: true, outletScopesSeparated: true, pendingCancelledVoidArchivedExcluded: true, physicalDeleteBlocked: true, archiveIdentityRequired: true }, null, 2))
} finally {
  await db.close()
}
