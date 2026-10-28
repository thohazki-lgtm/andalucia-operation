export type AnnualLeaveYearInput = {
  year: number
  serviceStartDate: string
  entitledUnits: number
  accrualUnitsPerCompletedMonth: number
  eligibleFrom: string
  eligibleThrough?: string | null
  openingBalanceAdjustmentUnits?: number | null
  confirmedUsed: number
}

export type AnnualLeaveYearBalance = AnnualLeaveYearInput & {
  completedEligibleMonths: number
  accruedUnits: number
  carryIn: number
  balance: number
}

const calendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('ENTITLEMENT_ELIGIBILITY_DATE_INVALID')
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error('ENTITLEMENT_ELIGIBILITY_DATE_INVALID')
  return date
}

const serviceMonthAnniversary = (serviceStart: Date, completedMonths: number) => {
  const targetMonth = serviceStart.getUTCMonth() + completedMonths
  const targetYear = serviceStart.getUTCFullYear() + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(serviceStart.getUTCDate(), lastDay)))
}

export const completedEligibleMonths = (input: Pick<AnnualLeaveYearInput, 'year' | 'serviceStartDate' | 'eligibleFrom' | 'eligibleThrough'>, asOf: string) => {
  const serviceStart = calendarDate(input.serviceStartDate)
  const from = calendarDate(input.eligibleFrom)
  const through = input.eligibleThrough ? calendarDate(input.eligibleThrough) : new Date(Date.UTC(input.year, 11, 31))
  const cutoff = calendarDate(asOf)
  if (from.getUTCFullYear() !== input.year || through.getUTCFullYear() !== input.year || through < from || serviceStart > through) throw new Error('ENTITLEMENT_ELIGIBILITY_RANGE_INVALID')
  const finalDate = cutoff < through ? cutoff : through
  if (finalDate < from) return 0
  let completed = 0
  for (let serviceMonth = 1; serviceMonth <= 1200; serviceMonth += 1) {
    const anniversary = serviceMonthAnniversary(serviceStart, serviceMonth)
    if (anniversary > finalDate) break
    if (anniversary >= from) completed += 1
  }
  return completed
}

export const calculateAnnualLeaveTimeline = (records: AnnualLeaveYearInput[], asOf: string): AnnualLeaveYearBalance[] => {
  const ordered = [...records].sort((left, right) => left.year - right.year)
  if (new Set(ordered.map(item => item.year)).size !== ordered.length) throw new Error('DUPLICATE_ANNUAL_LEAVE_ENTITLEMENT_YEAR')
  let carried = 0
  return ordered.map(record => {
    if (![record.entitledUnits, record.accrualUnitsPerCompletedMonth, record.confirmedUsed].every(Number.isFinite)) throw new Error('ENTITLEMENT_VALUE_INVALID')
    const months = completedEligibleMonths(record, asOf)
    const decimal = (value: number) => Number(value.toFixed(4))
    const accruedUnits = decimal(Math.min(record.entitledUnits, record.accrualUnitsPerCompletedMonth * months))
    // An approved opening balance replaces inferred carry for that year. Adding it
    // to prior carry would double-count the same historical entitlement evidence.
    const carryIn = decimal(record.openingBalanceAdjustmentUnits ?? carried)
    const balance = decimal(carryIn + accruedUnits - record.confirmedUsed)
    carried = balance
    return { ...record, completedEligibleMonths: months, accruedUnits, carryIn, balance }
  })
}

export const calendarYearPeriod = (year: number) => {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('ENTITLEMENT_YEAR_INVALID')
  return { start: `${year}-01-01`, end: `${year}-12-31`, endExclusive: `${year + 1}-01-01` }
}

export const calculateCalendarYearBalance = (entitledUnits: number | null, confirmedUsed: number) => entitledUnits === null
  ? { entitlement: null, used: confirmedUsed, remaining: null }
  : { entitlement: entitledUnits, used: confirmedUsed, remaining: entitledUnits - confirmedUsed }

export const calculateRenewingAnnualBalance = calculateCalendarYearBalance
