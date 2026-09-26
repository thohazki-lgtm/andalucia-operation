import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { FinancialPolicyInitializationService } from './financial-policy-initialization-service.js'
import { FinancialPreviewService } from './financial-preview-service.js'
import { AuthorizationService } from './authorization-service.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import { runMigrations } from './migration-store.js'
import { WineSpiritsRepository } from './wine-spirits-repository.js'

const db = new PGlite()
try {
  await db.exec(await readFile('database/schema.sql', 'utf8')); await runMigrations(db)
  const ownerId = randomUUID()
  await db.query("insert into user_accounts(id,login_identifier,normalized_login_identifier,display_name,password_hash,status) values($1,'preview-owner','preview-owner','Preview Owner','unused','active')", [ownerId])
  await db.query("insert into authorization_user_roles(id,user_id,role_id,active) select $1,$2,id,true from authorization_roles where role_key='owner'", [randomUUID(), ownerId])
  const authorization = new AuthorizationService(db)
  const auth = await authorization.authorizationForUser(ownerId)
  const principal = { userId: ownerId, sessionId: randomUUID(), loginIdentifier: 'preview-owner', displayName: 'Preview Owner', staffId: null, ...auth }
  await authorization.requireOutletPermission(principal, 'manage_bill_tips', ANDALUCIA_SCOPE_ID)
  await authorization.requireOutletPermission(principal, 'manage_incentives', ANDALUCIA_SCOPE_ID)

  const duties = [
    ['on','Duty','ON','working',true], ['off','Off','OFF','off',false], ['annual_leave','Annual Leave','AL','annualLeave',false],
    ['public_holiday','Public Holiday','PH','publicHoliday',false], ['sick_leave','Sick Leave','SK','sickLeave',false], ['training','Training','TRN','working',true], ['custom_setup','Setup','SET','working',true]
  ] as const
  for (const [index, [value,label,displayCode,dutyClassification,countsAsWorking]] of duties.entries()) await db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes',$2,$3,'#345678',$4,true,$5)", [randomUUID(), value, label, JSON.stringify({ displayCode, dutyClassification, countsAsWorking }), index])
  const packages = [['lobster_paella','Lobster Paella',85],['birthday_basic','Birthday Basic',75],['birthday_premium','Birthday Premium',135],['anniversary_basic','Anniversary Basic',75],['anniversary_premium','Anniversary Premium',135]] as const
  for (const [index, [value,label,price]] of packages.entries()) await db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,'chargeable_items',$2,$3,$4,true,$5)", [randomUUID(), value, label, JSON.stringify({ category: 'Food', price }), index])
  await db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,'chargeable_statuses','charged','Charged',$2,true,0),($3,'chargeable_statuses','pending','Pending',$4,true,1)", [randomUUID(), JSON.stringify({ countsAsRealizedRevenue: true, countsAsPendingValue: false }), randomUUID(), JSON.stringify({ countsAsRealizedRevenue: false, countsAsPendingValue: true })])

  const revision1 = randomUUID()
  await db.query("insert into staff_membership_baseline_reviews(id,outlet_scope_id,baseline_month,status,revision_number,review_type,is_current_revision,is_authoritative,approved_at,approved_by,approved_by_user_id) values($1,$2,'2026-09','approved',1,'initial',true,true,now(),$3,$4)", [revision1, ANDALUCIA_SCOPE_ID, `Preview Owner [${ownerId}]`, ownerId])
  const staffIds: string[] = []
  for (let index = 0; index < 12; index++) {
    const id = randomUUID(); staffIds.push(id)
    await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,$2,$3,'Waiter','active','2026-01-01')", [id, `EMP-${String(index + 1).padStart(3,'0')}`, `Preview Staff ${index + 1}`])
    await db.query("insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,effective_to,source,review_status,reviewed_at,reviewed_by,baseline_revision_id,is_current_baseline) values($1,$2,$3,'regular_outlet','2026-09-01','2026-09-30','baseline_manager_review','approved',now(),'Preview Owner',$4,true)", [randomUUID(), id, ANDALUCIA_SCOPE_ID, revision1])
    for (let day = 1; day <= 9; day++) {
      if (index === 1 && day === 2) continue
      let duty = 'on'
      if (index === 0 && day === 1) duty = 'annual_leave'
      if (index === 2 && day === 1) duty = 'off'
      if (index === 3 && day === 1) duty = 'public_holiday'
      if (index === 4 && day === 1) duty = 'training'
      if (index === 5 && day === 1) duty = 'custom_setup'
      if (index === 6 && day === 1) duty = 'sick_leave'
      await db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), id, `2026-09-${String(day).padStart(2,'0')}`, duty])
    }
  }
  const chargedFood = randomUUID(); const chargedPackage = randomUUID(); const pending = randomUUID()
  const insertCharge = (id: string, item: string, label: string, amount: number, status: string, seller: string | null) => db.query("insert into chargeable_item_records(id,outlet_scope_id,item_value,item_label,item_category,charge_date,guest_name,room_number,check_invoice_number,amount,quantity,unit_price,total_amount,status,waiter_id) values($1,$2,$3,$4,'Food','2026-09-05','Preview Guest','700',$5,$6,1,$6,$6,$7,$8)", [id, ANDALUCIA_SCOPE_ID, item, label, `PREVIEW-${id}`, amount, status, seller])
  await insertCharge(chargedFood, 'lobster_paella', 'Lobster Paella', 85, 'charged', staffIds[0])
  await insertCharge(chargedPackage, 'birthday_basic', 'Birthday Basic', 75, 'charged', null)
  await insertCharge(pending, 'lobster_paella', 'Lobster Paella', 95, 'pending', staffIds[2])
  await new FinancialPolicyInitializationService(db).initialize(ANDALUCIA_SCOPE_ID, principal)
  await db.query("insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,'employment_statuses','active','Active',$2,true,0),($3,'staff_positions','Waiter','Waiter',$4,true,0)", [randomUUID(), JSON.stringify({ eligibleForAssignments: true }), randomUUID(), JSON.stringify({ serviceAssignmentEligible: true })])
  const wineRepository = new WineSpiritsRepository(db)
  const wineChargedId = randomUUID()
  await wineRepository.save({ id: wineChargedId, serviceDate: '2026-09-05', checkInvoiceNumber: '  SYM-WINE-001  ', itemName: '  Château Exact Reserve  ', roomNumber: '701', tableNumber: 'Table 1', waiterId: staffIds[0], grossUnitPrice: '396.40', quantity: 2, status: 'charged', notes: 'Signed proof' }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })
  await wineRepository.save({ id: randomUUID(), serviceDate: '2026-09-05', checkInvoiceNumber: 'SYM-WINE-PENDING', itemName: 'Pending Bottle', roomNumber: '702', tableNumber: 'Table 2', waiterId: staffIds[2], grossUnitPrice: '95.00', quantity: 1, status: 'pending', notes: '' }, { outletScopeId: ANDALUCIA_SCOPE_ID, actor: principal })

  const transactionsBefore = await transactionCounts()
  const preview = await new FinancialPreviewService(db).preview({ month: '2026-09', outletScopeId: ANDALUCIA_SCOPE_ID, totalPool: '100.00', externalAllocations: [{ id: randomUUID(), name: 'Support Colleague', fixedAmount: '10.00', departmentOutlet: 'Guest Services' }], asOfDate: '2026-09-10' })
  assert.deepEqual({ revision: preview.membership.revisionNumber, members: preview.membership.memberCount, status: preview.periodStatus }, { revision: 1, members: 12, status: 'IN_PROGRESS' })
  const staffPreview = (index: number) => preview.billTips.staff.find(item => item.staffId === staffIds[index])!
  assert.deepEqual({ eligible: staffPreview(0).eligibleRecordedDays, al: staffPreview(0).alDaysExcluded, future: staffPreview(0).futureUnclosedDays }, { eligible: 8, al: 1, future: 21 })
  assert.deepEqual({ eligible: staffPreview(1).eligibleRecordedDays, missing: staffPreview(1).historicalMissingRosterDays, future: staffPreview(1).futureUnclosedDays }, { eligible: 8, missing: 1, future: 21 })
  assert.equal(staffPreview(2).eligibleRecordedDays, 8)
  for (const index of [3,4,5,6]) assert.equal(staffPreview(index).eligibleRecordedDays, 9)
  assert.deepEqual({ pool: preview.billTips.totalPool, external: preview.billTips.externalAllocationTotal, remaining: preview.billTips.remainingRegularTeamPool, days: preview.billTips.totalEligibleRecordedDays, review: preview.billTips.reviewStatus }, { pool: '100.00', external: '10.00', remaining: '90.00', days: 105, review: 'REVIEW_REQUIRED' })
  const reconciled = Number(preview.billTips.regularStaffDistributed) + Number(preview.billTips.externalAllocationTotal) + Number(preview.billTips.roundingRemainder)
  assert.equal(reconciled.toFixed(2), '100.00')
  assert.deepEqual({ realized: preview.incentives.realizedRecordCount, gross: preview.incentives.realizedGrossAmount, pending: preview.incentives.pendingExcludedCount, pendingAmount: preview.incentives.pendingExcludedAmount }, { realized: 3, gross: '952.80', pending: 2, pendingAmount: '190.00' })
  assert.deepEqual(preview.incentives.records.map(item => [item.sourceType,item.itemValue,item.eligibleNetAmount,item.incentive]), [['FOOD','lobster_paella','66.05','1.65'],['FOOD','birthday_basic','58.28','0.00'],['WINE_SPIRITS','wine_spirits','616.00','14.00']])
  assert.equal(preview.incentives.records[0].soldByStaffId, staffIds[0]); assert.equal(preview.incentives.wineSpiritsLiveSource, 'ACTIVE')
  const winePreview = preview.incentives.records.find(item => item.sourceId === wineChargedId)!
  assert.deepEqual({ check: winePreview.checkInvoiceNumber, item: winePreview.itemLabel, room: winePreview.roomNumber, grossUnit: winePreview.grossUnitPrice, netUnit: winePreview.eligibleNetUnitPrice, tier: winePreview.appliedTier }, { check: '  SYM-WINE-001  ', item: '  Château Exact Reserve  ', room: '701', grossUnit: '396.40', netUnit: '308.00', tier: '$250–$349 · $7.00' })
  assert.deepEqual({ unattributed: preview.incentives.unattributedRealizedCount, amount: preview.incentives.unattributedIncentiveAmount, review: preview.incentives.reviewStatus, seller: preview.incentives.records[1].soldByStaffId }, { unattributed: 1, amount: '0.00', review: 'REVIEW_REQUIRED', seller: null })
  assert.deepEqual({ food: preview.earnings.find(item => item.staffId === staffIds[0])?.foodIncentives, wine: preview.earnings.find(item => item.staffId === staffIds[0])?.wineSpiritsIncentives }, { food: '1.65', wine: '14.00' })
  assert.deepEqual(await transactionCounts(), transactionsBefore)
  await assert.rejects(() => new FinancialPreviewService(db).preview({ month: '2026-09', outletScopeId: ANDALUCIA_SCOPE_ID, totalPool: '50.00', externalAllocations: [{ id: randomUUID(), name: 'Unsupported Amount', fixedAmount: '7.00' }], asOfDate: '2026-09-10' }), /exactly \$5, \$10, \$15 or \$20/)

  const otherOutlet = randomUUID()
  await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values($1,'other_preview','Other Preview',true,'restaurant')", [otherOutlet])
  await assert.rejects(() => authorization.requireOutletPermission({ ...principal, sessionId: null as unknown as string, isOwner: false, globalScope: false, allowedOutletScopeIds: [ANDALUCIA_SCOPE_ID] }, 'manage_bill_tips', otherOutlet), /not authorized for the requested outlet scope/i)

  const revision2 = randomUUID()
  await db.query("update staff_membership_baseline_reviews set status='superseded',is_current_revision=false,is_authoritative=false where id=$1", [revision1])
  await db.query('update staff_membership_history set is_current_baseline=false where baseline_revision_id=$1', [revision1])
  await db.query("insert into staff_membership_baseline_reviews(id,outlet_scope_id,baseline_month,status,revision_number,previous_revision_id,review_type,is_current_revision,is_authoritative,approved_at,approved_by,approved_by_user_id) values($1,$2,'2026-09','approved',2,$3,'correction',true,true,now(),$4,$5)", [revision2, ANDALUCIA_SCOPE_ID, revision1, `Preview Owner [${ownerId}]`, ownerId])
  for (const id of staffIds) await db.query("insert into staff_membership_history(id,staff_id,outlet_scope_id,membership_dimension,effective_from,effective_to,source,review_status,reviewed_at,reviewed_by,baseline_revision_id,is_current_baseline) values($1,$2,$3,'regular_outlet','2026-09-01','2026-09-30','baseline_manager_review','approved',now(),'Preview Owner',$4,true)", [randomUUID(), id, ANDALUCIA_SCOPE_ID, revision2])
  const recalculated = await new FinancialPreviewService(db).preview({ month: '2026-09', outletScopeId: ANDALUCIA_SCOPE_ID, totalPool: '100.00', externalAllocations: [], asOfDate: '2026-09-10' })
  assert.equal(recalculated.membership.revisionNumber, 2)
  assert.deepEqual(await transactionCounts(), transactionsBefore)
  console.log(JSON.stringify({ approvedMembershipScope: true, revision1Snapshot: true, alExcluded: true, offZeroPhTrainingAndCustomWorkingEligible: true, futureUnclosedSeparated: true, historicalMissingFlagged: true, externalAllocation: true, reconciliation: true, realizedFoodAndWineOnly: true, pendingFoodAndWineExcluded: true, sellerUuid: true, foodExample: '$85.00 -> $66.05 -> $1.65', wineExample: '$396.40 -> $308.00 -> $7.00 per bottle', exactWineProofVisible: true, zeroPackage: true, wineSourceActive: true, earningsDerived: true, ownerAuthorized: true, outletIsolation: true, newestApprovedRevisionUsed: recalculated.membership.revisionNumber, finalizedFinancialTransactionsCreated: false }, null, 2))

  async function transactionCounts() {
    const result: Record<string, number> = {}
    for (const table of ['bill_tip_distributions','bill_tip_staff_allocations','bill_tip_manual_allocations','chargeable_incentive_earnings']) result[table] = Number((await db.query<any>(`select count(*)::int count from ${table}`)).rows[0].count)
    return result
  }
} finally { await db.close() }
