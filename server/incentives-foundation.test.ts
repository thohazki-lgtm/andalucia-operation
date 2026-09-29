import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { StaffRepository } from './staff-repository.js'
import { OperationsRepository } from './operations-repository.js'
import { ChargeableRepository } from './chargeable-repository.js'
import { IncentivesRepository } from './incentives-repository.js'
import type { BillTipManualAllocation, ChargeableIncentiveEarning, ChargeableRecord, IncentiveRule, IncentiveRuleTier } from '../src/domain.js'

const storage = await mkdtemp(join(tmpdir(), 'andalucia-incentives-foundation-'))
const databasePath = join(storage, 'postgres')
const schema = await readFile('database/schema.sql', 'utf8')
const initial = new PGlite(databasePath)
await initial.exec(schema)
for (const option of [
  { value: 'ON', label: 'Duty', displayCode: 'ON', classification: 'working', working: true },
  { value: 'OFF', label: 'Off', displayCode: 'OFF', classification: 'off', working: false },
  { value: 'AL', label: 'Annual Leave', displayCode: 'AL', classification: 'annualLeave', working: false },
  { value: 'DUTY_PH', label: 'Public Holiday', displayCode: 'PH', classification: 'publicHoliday', working: false },
  { value: 'DUTY_SK', label: 'Sick Leave', displayCode: 'SK', classification: 'sickLeave', working: false },
  { value: 'DUTY_TRN', label: 'Training', displayCode: 'TRN', classification: 'working', working: true },
  { value: 'DUTY_CUSTOM', label: 'Custom Support', displayCode: 'CUS', classification: 'other', working: false }
]) await initial.query('insert into configuration_options(id,group_key,value,label,metadata,active,sort_order) values($1,$2,$3,$4,$5,true,$6)', [randomUUID(), 'duty_codes', option.value, option.label, JSON.stringify({ displayCode: option.displayCode, dutyClassification: option.classification, countsAsWorking: option.working }), 50])
await initial.close()

const staffRepository = new StaffRepository(databasePath, new PGlite(databasePath))
try {
  await staffRepository.initialize()
  await staffRepository.getDatabase().exec('alter table chargeable_item_records add column if not exists check_invoice_number text')
  const db = staffRepository.getDatabase()
  const incentives = new IncentivesRepository(db)
  const chargeables = new ChargeableRepository(db)
  const operations = new OperationsRepository(db)
  await incentives.initialize(); await chargeables.initialize(); await operations.initialize()

  const dutyCodes = (await staffRepository.configuration()).dutyCodes
  const eligibility = Object.fromEntries(dutyCodes.map(option => [option.metadata?.displayCode || option.value, option.metadata?.billTipEligible]))
  assert.equal(eligibility.AL, false)
  for (const code of ['ON', 'OFF', 'PH', 'SK', 'TRN', 'CUS']) assert.equal(eligibility[code], true, `${code} should be Bill Tip eligible`)
  const custom = await staffRepository.saveConfiguration('duty-codes', { id: randomUUID(), value: '', label: 'Future Custom', color: '#456789', active: true, metadata: { displayCode: 'FTR', dutyClassification: 'other', countsAsWorking: false } })
  assert.equal(custom.metadata?.billTipEligible, true)

  const staff = (await staffRepository.list()).filter(person => person.employmentStatus === 'active')
  const regular = staff[0]
  await operations.updateRoster(regular.id, '2026-09-01', dutyCodes.find(option => (option.metadata?.displayCode || option.value) === 'OFF')!.value)
  assert.deepEqual((await operations.roster('2026-09-01', '2026-09-01')).map(row => [row.staffId, row.date, row.dutyCode]), [[regular.id, '2026-09-01', 'OFF']])

  const distribution = await incentives.createDistribution({ id: randomUUID(), distributionMonth: '2026-09', poolAmount: '1333.00', undistributedRemainder: '0.01' })
  assert.equal(distribution.poolAmount, '1333.00')
  assert.equal(distribution.status, 'draft')
  await assert.rejects(() => incentives.createDistribution({ id: randomUUID(), distributionMonth: '2026-09', poolAmount: '1.00' }), /already exists/)
  const allocation = await incentives.createStaffAllocation({ id: randomUUID(), distributionId: distribution.id, staffId: regular.id, eligibleDays: 20, excludedAlDays: 4, missingRosterDays: 1, requiresRosterReview: true, valuePerEligibleDay: '40.123456', calculatedAmount: '802.469120', finalAmount: '802.47' })
  assert.deepEqual({ eligibleDays: allocation.eligibleDays, excludedAlDays: allocation.excludedAlDays, missingRosterDays: allocation.missingRosterDays, review: allocation.requiresRosterReview, final: allocation.finalAmount }, { eligibleDays: 20, excludedAlDays: 4, missingRosterDays: 1, review: true, final: '802.47' })

  const staffCountBefore = Number((await db.query<{ count: number }>('select count(*)::int count from staff')).rows[0].count)
  const external: BillTipManualAllocation = { id: randomUUID(), distributionId: distribution.id, linkedStaffId: null, helperName: 'Banquet Support', department: 'Banquets', outlet: 'Events', fixedAmount: '20.00', reason: 'Dinner service support', notes: '', idempotencyKey: '2026-09-banquet-support-1' }
  const savedExternal = await incentives.createManualAllocation(external)
  assert.equal(savedExternal.linkedStaffId, null)
  assert.equal(savedExternal.fixedAmount, '20.00')
  const linked = await incentives.createManualAllocation({ ...external, id: randomUUID(), linkedStaffId: staff[1].id, helperName: staff[1].name, fixedAmount: '5.00', idempotencyKey: '2026-09-linked-support-1' })
  assert.equal(linked.linkedStaffId, staff[1].id)
  assert.equal(Number((await db.query<{ count: number }>('select count(*)::int count from staff')).rows[0].count), staffCountBefore)
  assert.equal((await incentives.setDistributionStatus(distribution.id, 'finalized')).status, 'finalized')
  await assert.rejects(() => incentives.setDistributionStatus(distribution.id, 'draft'), /audited reopen action/)
  await assert.rejects(() => incentives.createManualAllocation({ ...external, id: randomUUID(), idempotencyKey: 'finalized-change-blocked' }), /must be reopened/)

  const chargeableOptions = (await chargeables.configuration()).items
  const optionByValue = (value: string) => chargeableOptions.find(option => option.value === value)!
  const makeRule = (overrides: Partial<IncentiveRule> & Pick<IncentiveRule, 'ruleKey' | 'sourceKey' | 'ruleFamily'>): IncentiveRule => ({ id: randomUUID(), version: 1, effectiveFrom: '2026-09-01', active: true, tiers: [], ...overrides })
  const foodV1 = await incentives.createRule(makeRule({ ruleKey: 'chargeable:lobster_paella', sourceKey: 'lobster_paella', configurationOptionId: optionByValue('lobster_paella').id, ruleFamily: 'food_percentage', ratePercent: '2.5000' }))
  assert.equal(foodV1.ratePercent, '2.5000')
  const foodV2 = await incentives.createRule(makeRule({ ruleKey: foodV1.ruleKey, sourceKey: foodV1.sourceKey, configurationOptionId: foodV1.configurationOptionId, ruleFamily: 'food_percentage', ratePercent: '3.0000', version: 2, effectiveFrom: '2027-01-01' }))
  assert.equal(foodV2.version, 2)
  assert.equal((await incentives.rule(foodV1.id))?.ratePercent, '2.5000')
  assert.equal((await incentives.rule(foodV1.id))?.active, false)

  for (const packageIdentity of ['birthday_basic', 'birthday_premium', 'anniversary_basic', 'anniversary_premium']) {
    const rule = await incentives.createRule(makeRule({ ruleKey: `chargeable:${packageIdentity}`, sourceKey: packageIdentity, configurationOptionId: optionByValue(packageIdentity).id, ruleFamily: 'no_incentive' }))
    assert.equal(rule.ruleFamily, 'no_incentive')
  }

  const wineTiers: IncentiveRuleTier[] = [
    ['0.00', '39.99', 'none', '0.0000'], ['40.00', '69.99', 'fixed', '2.0000'], ['70.00', '99.99', 'fixed', '3.0000'],
    ['100.00', '129.99', 'fixed', '4.0000'], ['130.00', '199.99', 'fixed', '5.0000'], ['200.00', '249.99', 'fixed', '6.0000'],
    ['250.00', '349.99', 'fixed', '7.0000'], ['350.00', '499.99', 'fixed', '8.0000'], ['500.00', null, 'percentage', '2.5000']
  ].map(([minimumAmount, maximumAmount, rewardMode, rewardValue]) => ({ minimumAmount: String(minimumAmount), maximumAmount: maximumAmount == null ? null : String(maximumAmount), rewardMode: rewardMode as IncentiveRuleTier['rewardMode'], rewardValue: String(rewardValue) }))
  const wine = await incentives.createRule(makeRule({ ruleKey: 'wine-spirits:standard', sourceKey: 'wine_spirits', ruleFamily: 'wine_spirits_tier', tiers: wineTiers }))
  assert.deepEqual(wine.tiers.map(tier => [tier.minimumAmount, tier.maximumAmount, tier.rewardMode, tier.rewardValue]), wineTiers.map(tier => [tier.minimumAmount, tier.maximumAmount, tier.rewardMode, tier.rewardValue]))

  const seller = regular
  const sale: ChargeableRecord = { id: randomUUID(), date: '2026-09-08', bookingId: null, guestName: 'Foundation Guest', roomNumber: '700', checkInvoiceNumber: 'FOUNDATION-CHECK-001', tableNumber: 'T1', itemValue: 'lobster_paella', itemLabel: '', itemCategory: '', quantity: 1, unitPrice: 0, totalAmount: 0, waiterId: seller.id, waiter: null, status: 'charged', notes: '', active: true }
  const savedSale = await chargeables.save(sale)
  const earningInput: ChargeableIncentiveEarning = { id: randomUUID(), sourceChargeableItemId: savedSale.id, sellerId: seller.id, sellerNameSnapshot: '', sellerNumberSnapshot: '', designationSnapshot: '', serviceDate: savedSale.date, packageIdentity: savedSale.itemValue, quantity: savedSale.quantity, guestAmount: '85.00', eligibleNetAmount: '66.05', incentiveRuleId: foodV1.id, incentiveRuleVersion: 1, ruleFamilySnapshot: 'food_percentage', appliedRatePercent: '2.5000', calculatedAmount: '1.651250', finalAmount: '1.65', status: 'finalized', generationKey: `chargeable:${savedSale.id}:v1` }
  const earning = await incentives.createEarning(earningInput)
  assert.deepEqual({ net: earning.eligibleNetAmount, calculated: earning.calculatedAmount, final: earning.finalAmount, seller: earning.sellerId, sellerName: earning.sellerNameSnapshot, package: earning.packageIdentity }, { net: '66.05', calculated: '1.651250', final: '1.65', seller: seller.id, sellerName: seller.name, package: 'lobster_paella' })
  await assert.rejects(() => incentives.createEarning({ ...earningInput, id: randomUUID(), generationKey: `chargeable:${savedSale.id}:retry` }), /already has/)
  await db.query("update staff set full_name='Renamed Historical Seller',employment_status_key='inactive' where id=$1", [seller.id])
  const historical = await incentives.earning(earning.id)
  assert.equal(historical?.sellerNameSnapshot, seller.name)
  assert.equal(historical?.sellerId, seller.id)
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from audit_logs where entity_type in ('bill_tip_distribution','bill_tip_staff_allocation','bill_tip_manual_allocation','incentive_rule','chargeable_incentive_earning')")).rows[0].count) >= 10, true)

  console.log(JSON.stringify({ billTipEligibility: eligibility, monthlyDistribution: distribution.distributionMonth, distributionStatus: 'finalized', externalWithoutStaff: true, money: { pool: distribution.poolAmount, eligibleNet: earning.eligibleNetAmount, finalIncentive: earning.finalAmount }, rules: { foodV1: foodV1.ratePercent, foodV2: foodV2.ratePercent, noIncentivePackages: 4, wineTiers: wine.tiers.length }, duplicateEarningBlocked: true, historicalSellerPreserved: true, rosterUnchanged: true }, null, 2))
} finally {
  await staffRepository.getDatabase().close().catch(() => undefined)
  await rm(storage, { recursive: true, force: true })
}
