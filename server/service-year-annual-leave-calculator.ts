export type ServiceYearPeriod = {
  serviceYearNumber: number
  start: string
  end: string
  availableFrom: string
}

export type AnnualLeaveServiceYearEvidence = {
  serviceYearStart: string
  serviceYearEnd: string
  availableFrom: string
  entitledUnits: number
  accrualUnitsPerCompletedMonth: number
  approvedOpeningCarryUnits?: number | null
  openingCarryEffectiveDate?: string | null
  openingCarryReason?: string | null
}

export type AnnualLeaveOpeningAdjustmentEvidence = {
  effectiveDate: string
  units: number
  reason: string
}

export type ServiceYearAnnualLeavePosition = {
  period: ServiceYearPeriod
  completedServiceMonths: number
  accruingForNextServiceYear: number
  openingAdjustment: number
  knownAvailableEntitlement: number
  confirmedUsed: number
  knownRemaining: number
  availableBalance: number | null
  evidenceStatus: 'complete' | 'unconfigured'
  preAvailabilityUsageDates: string[]
}

const isoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('SERVICE_YEAR_DATE_INVALID')
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error('SERVICE_YEAR_DATE_INVALID')
  return date
}

const formatDate = (value: Date) => value.toISOString().slice(0, 10)
const decimal = (value: number) => Number(value.toFixed(4))

const addMonthsClamped = (source: Date, months: number) => {
  const targetMonth = source.getUTCMonth() + months
  const year = source.getUTCFullYear() + Math.floor(targetMonth / 12)
  const month = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(source.getUTCDate(), lastDay)))
}

const addYearsClamped = (source: Date, years: number) => addMonthsClamped(source, years * 12)
const dayBefore = (source: Date) => new Date(source.valueOf() - 86_400_000)

export const serviceYearPeriodFor = (joinDate: string, asOf: string): ServiceYearPeriod => {
  const joined = isoDate(joinDate)
  const cutoff = isoDate(asOf)
  if (cutoff < joined) throw new Error('SERVICE_YEAR_NOT_STARTED')
  let completedYears = cutoff.getUTCFullYear() - joined.getUTCFullYear()
  if (addYearsClamped(joined, completedYears) > cutoff) completedYears -= 1
  const start = addYearsClamped(joined, completedYears)
  const nextStart = addYearsClamped(joined, completedYears + 1)
  return {
    serviceYearNumber: completedYears + 1,
    start: formatDate(start),
    end: formatDate(dayBefore(nextStart)),
    availableFrom: formatDate(nextStart),
  }
}

export const completedServiceMonths = (joinDate: string, asOf: string) => {
  const joined = isoDate(joinDate)
  const cutoff = isoDate(asOf)
  if (cutoff < joined) throw new Error('SERVICE_YEAR_NOT_STARTED')
  let completed = 0
  for (let month = 1; month <= 1200; month += 1) {
    if (addMonthsClamped(joined, month) > cutoff) break
    completed += 1
  }
  return completed
}

const resolvedOpeningAdjustment = (joinDate: string, asOf: string, evidence: AnnualLeaveOpeningAdjustmentEvidence[]) => {
  const joined = isoDate(joinDate)
  const cutoff = isoDate(asOf)
  const byDate = new Map<string, Set<number>>()
  for (const item of evidence) {
    const effectiveDate = isoDate(item.effectiveDate)
    if (effectiveDate < joined) throw new Error('ANNUAL_LEAVE_OPENING_ADJUSTMENT_BEFORE_JOINING')
    if (!Number.isFinite(item.units) || !item.reason.trim()) throw new Error('ANNUAL_LEAVE_OPENING_ADJUSTMENT_INVALID')
    if (effectiveDate > cutoff) continue
    const effectiveDateKey = formatDate(effectiveDate)
    const values = byDate.get(effectiveDateKey) || new Set<number>()
    values.add(decimal(item.units))
    byDate.set(effectiveDateKey, values)
  }
  let total = 0
  for (const values of byDate.values()) {
    if (values.size > 1) throw new Error('ANNUAL_LEAVE_OPENING_ADJUSTMENT_CONFLICT')
    total += [...values][0] || 0
  }
  return decimal(total)
}

const validateEvidence = (joinDate: string, records: AnnualLeaveServiceYearEvidence[]) => {
  const joined = isoDate(joinDate)
  const ordered = [...records].sort((left, right) => left.serviceYearStart.localeCompare(right.serviceYearStart))
  if (new Set(ordered.map(item => item.serviceYearStart)).size !== ordered.length) throw new Error('DUPLICATE_ANNUAL_LEAVE_SERVICE_YEAR')
  for (const item of ordered) {
    const itemPeriod = serviceYearPeriodFor(joinDate, item.serviceYearStart)
    const expectedStart = isoDate(itemPeriod.start)
    const expectedNext = isoDate(itemPeriod.availableFrom)
    if (item.serviceYearStart !== formatDate(expectedStart)
      || item.serviceYearEnd !== formatDate(dayBefore(expectedNext))
      || item.availableFrom !== formatDate(expectedNext)) throw new Error('SERVICE_YEAR_BOUNDARY_INVALID')
    if (![item.entitledUnits, item.accrualUnitsPerCompletedMonth].every(value => Number.isFinite(value) && value >= 0)) throw new Error('SERVICE_YEAR_ENTITLEMENT_INVALID')
    const hasCarry = item.approvedOpeningCarryUnits !== null && item.approvedOpeningCarryUnits !== undefined
    if (hasCarry !== Boolean(item.openingCarryEffectiveDate)) throw new Error('SERVICE_YEAR_OPENING_EVIDENCE_INCOMPLETE')
    if (hasCarry && item.openingCarryEffectiveDate !== item.availableFrom) throw new Error('SERVICE_YEAR_OPENING_EFFECTIVE_DATE_INVALID')
  }
  return ordered
}

export const calculateServiceYearAnnualLeavePosition = (input: {
  joinDate: string
  asOf: string
  serviceYears: AnnualLeaveServiceYearEvidence[]
  confirmedAnnualLeaveDates: string[]
  openingAdjustments?: AnnualLeaveOpeningAdjustmentEvidence[]
}) : ServiceYearAnnualLeavePosition => {
  const period = serviceYearPeriodFor(input.joinDate, input.asOf)
  const ordered = validateEvidence(input.joinDate, input.serviceYears)
  const cutoff = isoDate(input.asOf)
  const months = completedServiceMonths(input.joinDate, input.asOf)
  // Historical service-year rows and manual carry-forward records remain audit
  // evidence only. Lifetime earning is derived once from Date of Joining, so
  // adding those rows again would duplicate entitlement already earned.
  void ordered
  const accruing = decimal(2.5 * months)
  const openingAdjustment = resolvedOpeningAdjustment(input.joinDate, input.asOf, input.openingAdjustments || [])
  const knownAvailableEntitlement = decimal(accruing + openingAdjustment)
  const uniqueUsage = [...new Set(input.confirmedAnnualLeaveDates)].sort()
  uniqueUsage.forEach(isoDate)
  const applicableUsage = uniqueUsage.filter(value => value >= input.joinDate && isoDate(value) <= cutoff)
  const firstMonthlyAvailability = formatDate(addMonthsClamped(isoDate(input.joinDate), 1))
  const preAvailabilityUsageDates = applicableUsage.filter(value => value < firstMonthlyAvailability)
  const confirmedUsed = applicableUsage.length
  const knownRemaining = decimal(knownAvailableEntitlement - confirmedUsed)
  return {
    period,
    completedServiceMonths: months,
    accruingForNextServiceYear: accruing,
    openingAdjustment,
    knownAvailableEntitlement,
    confirmedUsed,
    knownRemaining,
    availableBalance: knownRemaining,
    evidenceStatus: 'complete',
    preAvailabilityUsageDates,
  }
}
