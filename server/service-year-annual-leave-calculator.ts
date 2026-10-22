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
}

export type ServiceYearAnnualLeavePosition = {
  period: ServiceYearPeriod
  completedServiceMonths: number
  accruingForNextServiceYear: number
  knownAvailableEntitlement: number
  confirmedUsed: number
  knownRemaining: number
  availableBalance: number | null
  evidenceStatus: 'complete' | 'unconfigured'
  preAvailabilityUsageDates: string[]
}

export const ANNUAL_LEAVE_ZERO_CARRY_BASELINE_DATE = '2026-01-01'

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
  const period = serviceYearPeriodFor(joinDate, asOf)
  const completedYears = period.serviceYearNumber - 1
  let completed = 0
  for (let month = 1; month <= 12; month += 1) {
    if (addMonthsClamped(joined, completedYears * 12 + month) <= cutoff) completed += 1
  }
  return completed
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
}) : ServiceYearAnnualLeavePosition => {
  const period = serviceYearPeriodFor(input.joinDate, input.asOf)
  const ordered = validateEvidence(input.joinDate, input.serviceYears)
  const cutoff = isoDate(input.asOf)
  const months = completedServiceMonths(input.joinDate, input.asOf)
  const accruing = decimal(Math.min(30, 2.5 * months))
  const joined = isoDate(input.joinDate)
  const agreedBaseline = isoDate(ANNUAL_LEAVE_ZERO_CARRY_BASELINE_DATE)
  let baselineAvailability = addYearsClamped(joined, 1)
  while (baselineAvailability < agreedBaseline) baselineAvailability = addYearsClamped(baselineAvailability, 1)
  let automaticAvailable = 0
  for (let anniversary = baselineAvailability; anniversary <= cutoff; anniversary = addYearsClamped(anniversary, 1)) automaticAvailable += 30
  const availabilityCutoff = formatDate(baselineAvailability)
  const carry = ordered.filter(item => item.openingCarryEffectiveDate && isoDate(item.openingCarryEffectiveDate) >= baselineAvailability && isoDate(item.openingCarryEffectiveDate) <= cutoff && item.approvedOpeningCarryUnits !== null && item.approvedOpeningCarryUnits !== undefined).at(-1)
  const knownAvailableEntitlement = decimal(automaticAvailable + (carry?.approvedOpeningCarryUnits || 0))
  const uniqueUsage = [...new Set(input.confirmedAnnualLeaveDates)].sort()
  uniqueUsage.forEach(isoDate)
  const preAvailabilityUsageDates = uniqueUsage.filter(value => value < availabilityCutoff)
  const confirmedUsed = uniqueUsage.filter(value => value >= availabilityCutoff).length
  const knownRemaining = decimal(knownAvailableEntitlement - confirmedUsed)
  return {
    period,
    completedServiceMonths: months,
    accruingForNextServiceYear: accruing,
    knownAvailableEntitlement,
    confirmedUsed,
    knownRemaining,
    availableBalance: knownRemaining,
    evidenceStatus: 'complete',
    preAvailabilityUsageDates,
  }
}
