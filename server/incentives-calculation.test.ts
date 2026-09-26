import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { ChargeableRecord, FinancialRateVersion, IncentiveRule, IncentiveRuleTier } from '../src/domain.js'
import { billTipShares, eligibleNetFromGrossUnit, formatFixed, parseFixed } from './financial-decimal.js'
import { IncentivesCalculationService } from './incentives-calculation-service.js'
import { IncentivesRepository } from './incentives-repository.js'
import { ChargeableRepository } from './chargeable-repository.js'
import { StaffRepository } from './staff-repository.js'

const storage = await mkdtemp(join(tmpdir(), 'andalucia-incentives-calculation-'))
const databasePath = join(storage, 'postgres')
const schema = await readFile('database/schema.sql', 'utf8')
const initial = new PGlite(databasePath)
await initial.exec(schema)
await initial.exec("alter table chargeable_item_records add column check_invoice_number text not null default ''")
await initial.close()

const staffRepository = new StaffRepository(databasePath)
try {
  await staffRepository.initialize()
  const db = staffRepository.getDatabase()
  const repository = new IncentivesRepository(db)
  const service = new IncentivesCalculationService(db)
  const chargeables = new ChargeableRepository(db)
  await repository.initialize(); await chargeables.initialize()

  const duty = async (displayCode: string, classification: 'working' | 'off' | 'annualLeave' | 'publicHoliday' | 'sickLeave' | 'other', billTipEligible = true) => staffRepository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: displayCode, color: '#456789', active: true, metadata: { displayCode, dutyClassification: classification, countsAsWorking: classification === 'working', billTipEligible } })
  const configuration = await staffRepository.configuration()
  const value = (displayCode: string) => configuration.dutyCodes.find(item => (item.metadata?.displayCode || item.value) === displayCode)!.value
  const on = value('ON'); const al = value('AL')
  const off = (await duty('BTOFF', 'off')).value
  const ph = (await duty('BTPH', 'publicHoliday')).value
  const sk = (await duty('BTSK', 'sickLeave')).value
  const trn = (await duty('BTTRN', 'working')).value
  const custom = (await duty('BTCUS', 'other')).value
  const excludedCustom = (await duty('BTNO', 'other', false)).value
  assert.equal((await staffRepository.configuration()).dutyCodes.find(item => item.value === custom)?.metadata?.billTipEligible, true)
  assert.equal((await staffRepository.configuration()).dutyCodes.find(item => item.value === excludedCustom)?.metadata?.billTipEligible, false)

  const staff = (await staffRepository.list()).filter(item => item.employmentStatus === 'active').slice(0, 5)
  assert.equal(staff.length, 5)
  const septemberDates = Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`)
  for (let staffIndex = 0; staffIndex < staff.length; staffIndex++) {
    for (let dayIndex = 0; dayIndex < septemberDates.length; dayIndex++) {
      let code = dayIndex < 30 - staffIndex ? on : al
      if (staffIndex === 1 && dayIndex < 5) code = [off, ph, sk, trn, custom][dayIndex]
      await db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staff[staffIndex].id, septemberDates[dayIndex], code])
    }
  }

  const distribution = await repository.createDistribution({ id: randomUUID(), distributionMonth: '2026-09', poolAmount: '1333.00' })
  for (const [index, amount] of ['20.00', '15.00', '10.00', '5.00'].entries()) await repository.createManualAllocation({ id: randomUUID(), distributionId: distribution.id, linkedStaffId: null, helperName: `Support ${index + 1}`, fixedAmount: amount, reason: 'Monthly support', notes: '', idempotencyKey: `support-${index + 1}` })
  const draft = await service.calculateBillTipDraft(distribution.id, staff.map(item => item.id))
  assert.deepEqual(draft.staff.map(item => item.eligibleDays), [30, 29, 28, 27, 26])
  assert.deepEqual(draft.staff.map(item => item.excludedAlDays), [0, 1, 2, 3, 4])
  assert.equal(draft.staff.every(item => item.rosterDaysFound === 30 && !item.reviewRequired), true)
  assert.deepEqual({ pool: draft.distribution.poolAmount, external: draft.distribution.externalAllocationTotal, remaining: draft.distribution.remainingTeamPool, days: draft.distribution.totalEligibleDays }, { pool: '1333.00', external: '50.00', remaining: '1283.00', days: 140 })
  const expectedShares = billTipShares(parseFixed('1283.00', 2), [30, 29, 28, 27, 26])
  assert.equal(draft.distribution.valuePerEligibleDay, formatFixed(expectedShares.valuePerDayMicro, 6))
  assert.equal(draft.distribution.undistributedRemainder, formatFixed(expectedShares.remainderCents, 2))
  const allocations = await db.query<any>('select eligible_days,calculated_amount::text,final_amount::text from bill_tip_staff_allocations where distribution_id=$1 order by eligible_days desc', [distribution.id])
  assert.deepEqual(allocations.rows.map((row: any) => row.calculated_amount), expectedShares.calculatedMicro.map(value => formatFixed(value, 6)))
  assert.deepEqual(allocations.rows.map((row: any) => row.final_amount), expectedShares.finalCents.map(value => formatFixed(value, 2)))
  const reconciliation = parseFixed(draft.distribution.externalAllocationTotal, 2) + allocations.rows.reduce((sum: bigint, row: any) => sum + parseFixed(row.final_amount, 2), 0n) + parseFixed(draft.distribution.undistributedRemainder, 2)
  assert.equal(reconciliation, parseFixed('1333.00', 2))
  const repeatedDraft = await service.calculateBillTipDraft(distribution.id, staff.map(item => item.id))
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from bill_tip_staff_allocations where distribution_id=$1', [distribution.id])).rows[0].count), 5)
  assert.equal(repeatedDraft.distribution.id, distribution.id)
  const finalizedDistribution = await service.finalizeBillTip(distribution.id)
  assert.equal(finalizedDistribution.status, 'finalized')
  assert.equal((await service.finalizeBillTip(distribution.id)).id, finalizedDistribution.id)
  const frozenAllocations = JSON.stringify((await db.query<any>('select staff_id,eligible_days,final_amount::text from bill_tip_staff_allocations where distribution_id=$1 order by staff_id', [distribution.id])).rows)
  await db.query('update duty_roster_entries set duty_code_value=$3 where staff_id=$1 and duty_date=$2', [staff[0].id, '2026-09-01', al])
  assert.equal(JSON.stringify((await db.query<any>('select staff_id,eligible_days,final_amount::text from bill_tip_staff_allocations where distribution_id=$1 order by staff_id', [distribution.id])).rows), frozenAllocations)

  const missingDistribution = await repository.createDistribution({ id: randomUUID(), distributionMonth: '2026-10', poolAmount: '100.00' })
  await db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staff[0].id, '2026-10-01', on])
  const missingDraft = await service.calculateBillTipDraft(missingDistribution.id, [staff[0].id])
  assert.equal(missingDraft.staff[0].missingRosterDays, 30)
  assert.equal(missingDraft.staff[0].reviewRequired, true)
  await assert.rejects(() => service.finalizeBillTip(missingDistribution.id), /MANAGER REVIEW REQUIRED/)
  assert.equal((await repository.distribution(missingDistribution.id))?.status, 'draft')

  const excessive = await repository.createDistribution({ id: randomUUID(), distributionMonth: '2026-11', poolAmount: '10.00' })
  await repository.createManualAllocation({ id: randomUUID(), distributionId: excessive.id, linkedStaffId: null, helperName: 'Too much', fixedAmount: '10.01', reason: 'Validation', notes: '', idempotencyKey: 'too-much' })
  await assert.rejects(() => service.calculateBillTipDraft(excessive.id, [staff[0].id]), /cannot exceed/)
  await assert.rejects(() => repository.createDistribution({ id: randomUUID(), distributionMonth: '2026-09', poolAmount: '1.00' }), /already exists/)

  const customDistribution = await repository.createDistribution({ id: randomUUID(), distributionMonth: '2027-02', poolAmount: '27.00' })
  for (let day = 1; day <= 28; day++) await db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staff[1].id, `2027-02-${String(day).padStart(2, '0')}`, day === 1 ? excludedCustom : day === 2 ? custom : on])
  const customDraft = await service.calculateBillTipDraft(customDistribution.id, [staff[1].id])
  assert.deepEqual({ eligible: customDraft.staff[0].eligibleDays, missing: customDraft.staff[0].missingRosterDays, al: customDraft.staff[0].excludedAlDays }, { eligible: 27, missing: 0, al: 0 })

  const remainderDistribution = await repository.createDistribution({ id: randomUUID(), distributionMonth: '2027-03', poolAmount: '1.00' })
  for (const person of staff.slice(0, 3)) for (let day = 1; day <= 31; day++) await db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), person.id, `2027-03-${String(day).padStart(2, '0')}`, day === 1 ? on : al])
  const remainderDraft = await service.calculateBillTipDraft(remainderDistribution.id, staff.slice(0, 3).map(item => item.id))
  assert.equal(remainderDraft.distribution.undistributedRemainder, '0.01')
  assert.deepEqual((await db.query<any>('select final_amount::text from bill_tip_staff_allocations where distribution_id=$1 order by staff_id', [remainderDistribution.id])).rows.map((row: any) => row.final_amount), ['0.33', '0.33', '0.33'])
  assert.equal((await service.finalizeBillTip(remainderDistribution.id)).status, 'finalized')

  const transactionDistribution = await repository.createDistribution({ id: randomUUID(), distributionMonth: '2026-12', poolAmount: '31.00' })
  for (let day = 1; day <= 31; day++) await db.query('insert into duty_roster_entries(id,staff_id,duty_date,duty_code_value) values($1,$2,$3,$4)', [randomUUID(), staff[0].id, `2026-12-${String(day).padStart(2, '0')}`, on])
  await service.calculateBillTipDraft(transactionDistribution.id, [staff[0].id])
  await db.query("update bill_tip_distributions set undistributed_remainder='0.01' where id=$1", [transactionDistribution.id])
  await assert.rejects(() => service.finalizeBillTip(transactionDistribution.id), /does not reconcile/)
  assert.equal((await repository.distribution(transactionDistribution.id))?.status, 'draft')

  const reopenAuditBefore = Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='bill_tip_distribution' and entity_id=$1", [distribution.id])).rows[0].count)
  await assert.rejects(() => repository.reopenDistribution(distribution.id, ''), /reason/)
  assert.equal((await repository.reopenDistribution(distribution.id, 'Manager-approved correction')).status, 'draft')
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type='bill_tip_distribution' and entity_id=$1", [distribution.id])).rows[0].count) > reopenAuditBefore, true)

  const rateV1: FinancialRateVersion = { id: randomUUID(), version: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', serviceChargeRate: '10.0000', gstRate: '17.0000', active: true }
  await repository.createFinancialRate(rateV1)
  const options = (await chargeables.configuration()).items
  const option = (key: string) => options.find(item => item.value === key)!
  const makeRule = (sourceKey: string, family: IncentiveRule['ruleFamily'], extra: Partial<IncentiveRule> = {}): IncentiveRule => ({ id: randomUUID(), ruleKey: `chargeable:${sourceKey}`, sourceKey, configurationOptionId: option(sourceKey)?.id || null, ruleFamily: family, version: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', active: true, tiers: [], ...extra })
  const foodV1 = await repository.createRule(makeRule('lobster_paella', 'food_percentage', { ratePercent: '2.5000' }))
  const foodCalculation = service.calculateIncentive(foodV1, '85.00', 1, '10.0000', '17.0000')
  assert.deepEqual(foodCalculation, { grossTotal: '85.00', eligibleNetTotal: '66.05', appliedRatePercent: '2.5000', appliedFixedAmount: null, appliedTierMinimum: null, appliedTierMaximum: null, calculatedAmount: '1.651250', finalAmount: '1.65' })
  assert.deepEqual(service.calculateIncentive(foodV1, '85.00', 2, '10.0000', '17.0000'), { ...foodCalculation, grossTotal: '170.00', eligibleNetTotal: '132.10', calculatedAmount: '3.302500', finalAmount: '3.30' })

  const noIncentiveRules: IncentiveRule[] = []
  for (const key of ['birthday_basic', 'birthday_premium', 'anniversary_basic', 'anniversary_premium']) noIncentiveRules.push(await repository.createRule(makeRule(key, 'no_incentive')))
  for (const rule of noIncentiveRules) assert.equal(service.calculateIncentive(rule, '135.00', 1, '10.0000', '17.0000').finalAmount, '0.00')

  const wineTiers: IncentiveRuleTier[] = [
    ['0.00', '39.99', 'none', '0.0000'], ['40.00', '69.99', 'fixed', '2.0000'], ['70.00', '99.99', 'fixed', '3.0000'], ['100.00', '129.99', 'fixed', '4.0000'], ['130.00', '199.99', 'fixed', '5.0000'], ['200.00', '249.99', 'fixed', '6.0000'], ['250.00', '349.99', 'fixed', '7.0000'], ['350.00', '499.99', 'fixed', '8.0000'], ['500.00', null, 'percentage', '2.5000']
  ].map(([minimumAmount, maximumAmount, rewardMode, rewardValue]) => ({ minimumAmount: String(minimumAmount), maximumAmount: maximumAmount == null ? null : String(maximumAmount), rewardMode: rewardMode as IncentiveRuleTier['rewardMode'], rewardValue: String(rewardValue) }))
  const wine: IncentiveRule = { id: randomUUID(), ruleKey: 'wine-spirits:standard', sourceKey: 'wine_spirits', ruleFamily: 'wine_spirits_tier', version: 1, effectiveFrom: '2026-01-01', active: true, tiers: wineTiers }
  const wineCases: Array<[string, string]> = [['39.99', '0.00'], ['40.00', '2.00'], ['69.99', '2.00'], ['70.00', '3.00'], ['99.99', '3.00'], ['100.00', '4.00'], ['129.99', '4.00'], ['130.00', '5.00'], ['199.99', '5.00'], ['200.00', '6.00'], ['249.99', '6.00'], ['250.00', '7.00'], ['349.99', '7.00'], ['350.00', '8.00'], ['499.99', '8.00'], ['500.00', '12.50']]
  for (const [eligibleValue, expected] of wineCases) assert.equal(service.calculateIncentive(wine, eligibleValue, 1, '0.0000', '0.0000').finalAmount, expected, `Wine boundary ${eligibleValue}`)
  const grossForNet = (netValue: string) => {
    const target = parseFixed(netValue, 2)
    for (let cents = target; cents <= target * 2n + 100n; cents++) if (eligibleNetFromGrossUnit(cents, 1, '10.0000', '17.0000').eligibleNetTotalCents === target) return formatFixed(cents, 2)
    throw new Error(`No two-decimal Symphony gross resolves to net ${netValue}.`)
  }
  const grossBoundaryCases = wineCases.map(([netValue, expected]) => [grossForNet(netValue), netValue, expected] as const)
  for (const [grossValue, netValue, expected] of grossBoundaryCases) {
    const calculated = service.calculateIncentive(wine, grossValue, 1, '10.0000', '17.0000')
    assert.equal(calculated.eligibleNetTotal, netValue, `Symphony gross ${grossValue}`)
    assert.equal(calculated.finalAmount, expected, `Wine net boundary ${netValue}`)
  }
  const historicalError = service.calculateIncentive(wine, '396.40', 1, '10.0000', '17.0000')
  assert.deepEqual({ net: historicalError.eligibleNetTotal, incentive: historicalError.finalAmount }, { net: '308.00', incentive: '7.00' })
  const gross95 = grossForNet('95.00'); const gross500 = grossForNet('500.00')
  assert.deepEqual({ net: service.calculateIncentive(wine, gross95, 2, '10.0000', '17.0000').eligibleNetTotal, incentive: service.calculateIncentive(wine, gross95, 2, '10.0000', '17.0000').finalAmount }, { net: '190.00', incentive: '6.00' })
  assert.deepEqual({ net: service.calculateIncentive(wine, gross500, 2, '10.0000', '17.0000').eligibleNetTotal, incentive: service.calculateIncentive(wine, gross500, 2, '10.0000', '17.0000').finalAmount }, { net: '1000.00', incentive: '25.00' })

  const seller = staff[0]
  const saveSale = (id: string, date: string, itemValue: string, status = 'charged', quantity = 1): Promise<ChargeableRecord> => chargeables.save({ id, date, bookingId: null, guestName: 'Calculation Guest', roomNumber: '700', checkInvoiceNumber: `CALC-${id}`, tableNumber: 'T1', itemValue, itemLabel: '', itemCategory: '', quantity, unitPrice: 0, totalAmount: 0, waiterId: seller.id, waiter: null, status, notes: '', active: true })
  const foodSale = await saveSale(randomUUID(), '2026-09-08', 'lobster_paella')
  const draftEarning = await service.generateDraftEarning(foodSale.id)
  assert.deepEqual({ net: draftEarning.eligibleNetAmount, final: draftEarning.finalAmount, sc: draftEarning.serviceChargeRate, gst: draftEarning.gstRate, seller: draftEarning.sellerId }, { net: '66.05', final: '1.65', sc: '10.0000', gst: '17.0000', seller: seller.id })
  assert.equal((await service.generateDraftEarning(foodSale.id)).id, draftEarning.id)
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from chargeable_incentive_earnings where source_chargeable_item_id=$1', [foodSale.id])).rows[0].count), 1)
  const finalizedEarning = await service.finalizeEarning(draftEarning.id)
  assert.equal(finalizedEarning.status, 'finalized')
  assert.equal((await service.finalizeEarning(draftEarning.id)).id, finalizedEarning.id)

  const pendingSale = await saveSale(randomUUID(), '2026-09-08', 'lobster_paella', 'pending')
  await assert.rejects(() => service.generateDraftEarning(pendingSale.id), /Only realized/)
  for (const rule of noIncentiveRules) {
    const sale = await saveSale(randomUUID(), '2026-09-08', rule.sourceKey)
    assert.equal((await service.generateDraftEarning(sale.id)).finalAmount, '0.00')
  }

  const rateV2 = await repository.createFinancialRate({ id: randomUUID(), version: 2, effectiveFrom: '2027-01-01', serviceChargeRate: '10.0000', gstRate: '18.0000', active: true })
  const foodV2 = await repository.createRule({ ...foodV1, id: randomUUID(), version: 2, effectiveFrom: '2027-01-01', effectiveTo: null, ratePercent: '3.0000', active: true })
  const historical = await repository.earning(finalizedEarning.id)
  assert.deepEqual({ rule: historical?.incentiveRuleVersion, rateVersion: historical?.financialRateVersion, sc: historical?.serviceChargeRate, gst: historical?.gstRate, net: historical?.eligibleNetAmount, final: historical?.finalAmount }, { rule: 1, rateVersion: 1, sc: '10.0000', gst: '17.0000', net: '66.05', final: '1.65' })
  const newSale = await saveSale(randomUUID(), '2027-01-08', 'lobster_paella')
  const newEarning = await service.generateDraftEarning(newSale.id)
  assert.equal(newEarning.incentiveRuleVersion, foodV2.version)
  assert.equal(newEarning.financialRateVersion, rateV2.version)
  assert.equal(newEarning.appliedRatePercent, '3.0000')

  const sellerName = finalizedEarning.sellerNameSnapshot
  await db.query("update staff set full_name='Later Seller Name' where id=$1", [seller.id])
  assert.equal((await repository.earning(finalizedEarning.id))?.sellerNameSnapshot, sellerName)
  await assert.rejects(() => service.reverseEarning(finalizedEarning.id, ''), /reason/)
  const reversal = await service.reverseEarning(finalizedEarning.id, 'Source correction')
  assert.equal(reversal.reversalOfId, finalizedEarning.id)
  assert.equal(reversal.status, 'reversed')
  assert.equal((await service.reverseEarning(finalizedEarning.id, 'Retry')).id, reversal.id)
  const replacement = await service.generateDraftEarning(foodSale.id)
  assert.notEqual(replacement.id, finalizedEarning.id)
  assert.equal((await service.finalizeEarning(replacement.id)).status, 'finalized')

  const summary = await service.earningsSummary()
  const sellerSummary = summary.find(item => item.staffId === seller.id)
  assert.equal(sellerSummary?.foodIncentiveTotal, '1.65')
  assert.equal(summary.every(item => parseFixed(item.totalExtraEarnings, 2) === parseFixed(item.billTipTotal, 2) + parseFixed(item.foodIncentiveTotal, 2) + parseFixed(item.wineSpiritsIncentiveTotal, 2)), true)

  console.log(JSON.stringify({ billTips: { pool: draft.distribution.poolAmount, external: draft.distribution.externalAllocationTotal, remaining: draft.distribution.remainingTeamPool, eligibleDays: draft.distribution.totalEligibleDays, perDay: draft.distribution.valuePerEligibleDay, remainder: draft.distribution.undistributedRemainder, reconciled: true, missingRosterBlocked: true, finalizedSnapshotFrozen: true, reopenAudited: true }, food: foodCalculation, noIncentivePackages: noIncentiveRules.length, wineBoundaries: wineCases.length, grossSymphonyBoundaries: grossBoundaryCases.length, historicalErrorCorrection: { gross: '396.40', net: historicalError.eligibleNetTotal, incentive: historicalError.finalAmount }, perBottleQuantity: { twoAtNet95: '6.00', twoAtNet500: '25.00' }, rateVersions: [rateV1.version, rateV2.version], ruleVersions: [foodV1.version, foodV2.version], sellerSnapshotPreserved: true, draftIdempotent: true, finalizationIdempotent: true, reversalIdempotent: true, replacementCreated: true, transactionSafety: true, earningsSummaryDerived: true }, null, 2))
} finally {
  await staffRepository.getDatabase().close().catch(() => undefined)
  await rm(storage, { recursive: true, force: true })
}
