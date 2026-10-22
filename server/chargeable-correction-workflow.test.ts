import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createDisposableDevelopmentStore } from './test-store-fixture.js'
import { ChargeableRepository } from './chargeable-repository.js'
import { FinancialPolicyInitializationService } from './financial-policy-initialization-service.js'
import { IncentivesCalculationService } from './incentives-calculation-service.js'
import { ReportingRepository } from './reporting-repository.js'
import { ANDALUCIA_SCOPE_ID } from './outlet-membership-repository.js'
import type { AuthPrincipal, ChargeableRecord } from '../src/domain.js'

const fixture = await createDisposableDevelopmentStore('chargeable-correction')
try {
  const db = fixture.db
  const repository = new ChargeableRepository(db)
  await repository.initialize()
  const owner = (await db.query<any>('select id,display_name from user_accounts where id=$1', [fixture.ownerId])).rows[0]
  const actor: AuthPrincipal = { userId: owner.id, sessionId: randomUUID(), loginIdentifier: 'owner', displayName: owner.display_name, staffId: null, roleKeys: ['owner'], permissionKeys: ['manage_chargeables','manage_incentives','manage_financial_rules','perform_financial_corrections'], globalScope: true, allowedOutletScopeIds: [], isOwner: true }
  await db.query("insert into configuration_options(id,group_key,value,label,color,metadata,active,sort_order) values($1,'duty_codes','on','Duty','#123456',$2,true,1)", [randomUUID(), JSON.stringify({ displayCode: 'ON', dutyClassification: 'working', countsAsWorking: true, billTipEligible: true, billTipWorkedDayUnits: 1 })])
  await new FinancialPolicyInitializationService(db).initialize(ANDALUCIA_SCOPE_ID, actor)
  const waiter = { id: randomUUID() }
  await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date) values($1,'COR-001','Correction Waiter','F&B Attendant','active','2024-01-01')", [waiter.id])
  const configuration = await repository.configuration()
  const lobster = configuration.items.find(item => item.value === 'lobster_paella')!
  const charged = configuration.statuses.find(item => item.metadata?.countsAsRealizedRevenue)!
  const context = { outletScopeId: ANDALUCIA_SCOPE_ID, actor: `${owner.display_name} [${owner.id}]` }
  const source = (guest: string): ChargeableRecord => ({ id: randomUUID(), date: '2026-10-18', bookingId: null, guestName: guest, roomNumber: '701', checkInvoiceNumber: `CHECK-${randomUUID()}`, tableNumber: 'T1', itemValue: lobster.value, itemLabel: lobster.label, itemCategory: lobster.metadata?.category || 'Food', quantity: 1, unitPrice: Number(lobster.metadata?.price), totalAmount: 0, waiterId: waiter.id, waiter: null, status: charged.value, notes: '', active: true })

  const roomSale = await repository.save(source('Room correction guest'), context)
  const revenueBefore = (await repository.summary(roomSale.date, ANDALUCIA_SCOPE_ID)).realizedRevenue
  const correctedRoom = await repository.correctRealized({ ...roomSale, roomNumber: '702', correctionReason: 'Guest was charged to the incorrect room', confirmation: 'CORRECT CHARGED TRANSACTION', expectedUpdatedAt: roomSale.updatedAt }, context)
  assert.equal(correctedRoom.roomNumber, '702')
  assert.equal((await repository.summary(roomSale.date, ANDALUCIA_SCOPE_ID)).realizedRevenue, revenueBefore)
  const history = await repository.correctionHistory(roomSale.id, ANDALUCIA_SCOPE_ID)
  assert.equal(history[0].before?.roomNumber, '701')
  assert.equal(history[0].after?.roomNumber, '702')
  assert.match(history[0].actor, new RegExp(owner.id))
  const reportAfterRoomCorrection = await new ReportingRepository(db).report('today', roomSale.date, roomSale.date)
  assert.equal(reportAfterRoomCorrection.chargeables.financialProofRecords.find(item => item.id === roomSale.id)?.roomNumber, '702')
  await assert.rejects(() => repository.save({ ...correctedRoom, roomNumber: '703' }, context), /immutable/)
  await assert.rejects(() => repository.correctRealized({ ...correctedRoom, roomNumber: '703', correctionReason: 'Incorrect confirmation should fail', confirmation: '', expectedUpdatedAt: correctedRoom.updatedAt }, context), /explicitly/)

  const draftSale = await repository.save(source('Draft incentive correction'), context)
  const incentiveService = new IncentivesCalculationService(db, () => undefined)
  const draftBefore = await incentiveService.generateDraftEarning(draftSale.id, context.actor)
  const correctedQuantity = await repository.correctRealized({ ...draftSale, quantity: 2, correctionReason: 'Signed check confirms two eligible items', confirmation: 'CORRECT CHARGED TRANSACTION', expectedUpdatedAt: draftSale.updatedAt }, context)
  const draftAfter = (await db.query<any>("select quantity,final_amount::text from chargeable_incentive_earnings where source_chargeable_item_id=$1 and status='draft'", [draftSale.id])).rows[0]
  assert.equal(correctedQuantity.totalAmount, draftSale.unitPrice * 2)
  assert.equal(Number(draftAfter.quantity), 2)
  assert.notEqual(draftAfter.final_amount, draftBefore.finalAmount)

  const lockedSale = await repository.save(source('Finalized incentive correction'), context)
  const finalizedDraft = await incentiveService.generateDraftEarning(lockedSale.id, context.actor)
  await incentiveService.finalizeEarning(finalizedDraft.id, context.actor)
  await assert.rejects(() => repository.correctRealized({ ...lockedSale, quantity: 2, correctionReason: 'Attempt to rewrite finalized incentive', confirmation: 'CORRECT CHARGED TRANSACTION', expectedUpdatedAt: lockedSale.updatedAt }, context), /finalized incentive/)
  const roomOnlyAfterFinalization = await repository.correctRealized({ ...lockedSale, roomNumber: '799', correctionReason: 'Correct room after manager verification', confirmation: 'CORRECT CHARGED TRANSACTION', expectedUpdatedAt: lockedSale.updatedAt }, context)
  assert.equal(roomOnlyAfterFinalization.roomNumber, '799')
  assert.equal((await db.query<any>("select status from chargeable_incentive_earnings where source_chargeable_item_id=$1 and status='finalized'", [lockedSale.id])).rows[0].status, 'finalized')

  console.log(JSON.stringify({ roomCorrectionAudited: true, roomCorrectionRevenueUnchanged: true, ordinaryEditStillBlocked: true, explicitConfirmationRequired: true, provisionalIncentiveRecalculated: true, finalizedFinancialRewriteBlocked: true, finalizedNonFinancialCorrectionPreserved: true, schema: '025', canonicalDatabaseTouched: false }, null, 2))
} finally {
  await fixture.cleanup()
}
