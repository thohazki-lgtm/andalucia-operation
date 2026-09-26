import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { AuthPrincipal, WineSpiritSaleInput } from '../src/domain.js'
import { FinancialPolicyInitializationService } from './financial-policy-initialization-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { runMigrations } from './migration-store.js'
import { WineSpiritsRepository } from './wine-spirits-repository.js'

const db = new PGlite()
try {
  await db.exec(await readFile('database/schema.sql', 'utf8'))
  await runMigrations(db)
  const ownerId = randomUUID()
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'wine-owner','wine-owner','Wine Owner','unused','active')", [ownerId])
  const principal: AuthPrincipal = { userId: ownerId, sessionId: randomUUID(), loginIdentifier: 'wine-owner', displayName: 'Wine Owner', staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_chargeables','manage_incentives','manage_financial_rules'], globalScope: true, allowedOutletScopeIds: [], isOwner: true }
  const configs = [
    [randomUUID(), 'duty_codes', 'on', 'Duty', { displayCode: 'ON', dutyClassification: 'working', countsAsWorking: true }],
    [randomUUID(), 'employment_statuses', 'active', 'Active', { eligibleForAssignments: true }],
    [randomUUID(), 'employment_statuses', 'inactive', 'Inactive', { eligibleForAssignments: false }],
    [randomUUID(), 'staff_positions', 'Waiter', 'Waiter', { serviceAssignmentEligible: true }],
    [randomUUID(), 'staff_positions', 'Chef', 'Chef', { serviceAssignmentEligible: false }],
    [randomUUID(), 'chargeable_items', 'lobster_paella', 'Lobster Paella', { category: 'Food', price: 85 }],
    [randomUUID(), 'chargeable_items', 'birthday_basic', 'Birthday Basic', { category: 'Guest Occasion', price: 75 }],
    [randomUUID(), 'chargeable_items', 'birthday_premium', 'Birthday Premium', { category: 'Guest Occasion', price: 135 }],
    [randomUUID(), 'chargeable_items', 'anniversary_basic', 'Anniversary Basic', { category: 'Guest Occasion', price: 75 }],
    [randomUUID(), 'chargeable_items', 'anniversary_premium', 'Anniversary Premium', { category: 'Guest Occasion', price: 135 }],
  ] as const
  for (const [index, config] of configs.entries()) await db.query('insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,$2,$3,$4,$5,true,$6)', [config[0], config[1], config[2], config[3], JSON.stringify(config[4]), index])
  await new FinancialPolicyInitializationService(db).initialize(ANDALUCIA_SCOPE_ID, principal)
  const waiterId = randomUUID(); const inactiveId = randomUUID(); const chefId = randomUUID()
  await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'W-001','Exact Waiter','Waiter','active','2026-01-01'),($2,'W-002','Inactive Waiter','Waiter','inactive','2026-01-01'),($3,'C-001','Chef','Chef','active','2026-01-01')", [waiterId, inactiveId, chefId])
  const repository = new WineSpiritsRepository(db)
  assert.deepEqual(await repository.catalog(), [])
  const catalogId = randomUUID()
  const catalog = await repository.saveCatalog({ id: catalogId, value: '', label: 'Approved Test Bottle', active: true, metadata: { sellingPrice: 396.40, eligiblePrice: 308, incentiveRuleKey: 'wine-spirits:standard' } as any }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })
  assert.equal(catalog.label, 'Approved Test Bottle')
  assert.equal(Number((await db.query<any>("select count(*)::int count from audit_logs where entity_type='wine_spirit_catalog' and entity_id=$1", [catalogId])).rows[0].count), 1)
  const base = (overrides: Partial<WineSpiritSaleInput> = {}): WineSpiritSaleInput => ({ id: randomUUID(), serviceDate: '2026-09-12', checkInvoiceNumber: '  CHECK Exact 001  ', itemName: '  Château Exact Reserve  ', roomNumber: '  888A  ', tableNumber: 'Table 3', waiterId, grossUnitPrice: '396.40', quantity: 1, status: 'charged', notes: 'Manager proof', ...overrides })
  const saved = await repository.save(base({ id: '11111111-1111-4111-8111-111111111111' }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })
  assert.deepEqual({ check: saved.checkInvoiceNumber, item: saved.itemName, room: saved.roomNumber, staff: saved.waiter.number, outlet: saved.outletScopeId }, { check: '  CHECK Exact 001  ', item: '  Château Exact Reserve  ', room: '  888A  ', staff: 'W-001', outlet: ANDALUCIA_SCOPE_ID })
  assert.deepEqual({ gross: saved.grossUnitPrice, net: saved.netUnitPrice, tier: saved.appliedTier, incentive: saved.incentivePerBottle }, { gross: '396.40', net: '308.00', tier: '$250–$349 · $7.00', incentive: '7.00' })
  await db.query("update staff set full_name='Renamed Exact Waiter' where id=$1", [waiterId])
  assert.equal((await repository.find(saved.id, ANDALUCIA_SCOPE_ID))?.waiter.name, 'Exact Waiter')
  const quantity = await repository.save(base({ checkInvoiceNumber: 'QTY-2', itemName: 'Two Bottle Rule', grossUnitPrice: '122.27', quantity: 2 }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })
  assert.deepEqual({ netUnit: quantity.netUnitPrice, grossTotal: quantity.grossTotal, tier: quantity.appliedTier, each: quantity.incentivePerBottle, total: quantity.totalIncentive }, { netUnit: '95.00', grossTotal: '244.54', tier: '$70–$99 · $3.00', each: '3.00', total: '6.00' })
  const percentage = await repository.save(base({ checkInvoiceNumber: 'PCT-2', itemName: 'Two Premium Bottles', grossUnitPrice: '643.50', quantity: 2 }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })
  assert.deepEqual({ netUnit: percentage.netUnitPrice, tier: percentage.appliedTier, each: percentage.incentivePerBottle, total: percentage.totalIncentive }, { netUnit: '500.00', tier: '$500+ · 2.5%', each: '12.50', total: '25.00' })
  const duplicate = base({ id: randomUUID() }); await repository.save(duplicate, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })
  assert.equal((await repository.duplicateWarnings(duplicate, ANDALUCIA_SCOPE_ID)).length, 1)
  await assert.rejects(() => repository.save(base({ waiterId: inactiveId }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal }), /not eligible/)
  await assert.rejects(() => repository.save(base({ waiterId: chefId }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal }), /not eligible/)
  await assert.rejects(() => repository.save(base({ checkInvoiceNumber: ' ' }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal }), /required/)
  await assert.rejects(() => repository.save(base({ roomNumber: ' ' }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal }), /required/)
  const pending = await repository.save(base({ checkInvoiceNumber: 'PENDING', itemName: 'Pending Bottle', status: 'pending' }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })
  const cancelled = await repository.save(base({ checkInvoiceNumber: 'CANCELLED', itemName: 'Cancelled Bottle', status: 'cancelled' }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })
  const voided = await repository.save(base({ checkInvoiceNumber: 'VOID', itemName: 'Void Bottle', status: 'void' }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })
  assert.deepEqual([pending.status, cancelled.status, voided.status], ['pending','cancelled','void'])
  await assert.rejects(() => repository.save(base({ id: saved.id, checkInvoiceNumber: 'EDITED-CHECK' }), { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal }), /immutable/)
  const archived = await repository.archive(saved.id, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal }, 'Manager corrected signed check entry')
  assert.deepEqual({ archived: archived.archived, status: archived.status }, { archived: true, status: 'void' })
  const audit = await repository.auditHistory(saved.id, ANDALUCIA_SCOPE_ID)
  assert.deepEqual(audit.map(item => item.action).sort(), ['corrected','created'].sort())
  await assert.rejects(() => db.query('delete from wine_spirit_sales where id=$1', [saved.id]), /cannot be deleted/)
  assert.equal((await repository.list({ start: '2026-09-01', end: '2026-09-30', outletScopeId: randomUUID() })).length, 0)
  console.log(JSON.stringify({ exactProofPreserved: true, staffUuidResolved: true, outletScoped: true, grossToNet: '$396.40 -> $308.00', tier: '$7.00', quantityPerBottle: '$3.00 x 2 = $6.00', percentageTier: '$12.50 x 2 = $25.00', duplicateWarning: true, ineligibleStaffBlocked: true, proofValidation: true, statuses: true, realizedImmutable: true, correctionAudit: true, destructiveDeleteBlocked: true }, null, 2))
} finally { await db.close() }
