export const MALDIVES_TIME_ZONE = 'Indian/Maldives'

const dateParts = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`Invalid calendar date: ${value}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

const fromUtcDate = (value: Date) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
const asUtcDate = (value: string) => { const { year, month, day } = dateParts(value); return new Date(Date.UTC(year, month - 1, day)) }

export const serviceDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: MALDIVES_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export const serviceTime = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: MALDIVES_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '00'
  return `${part('hour')}:${part('minute')}`
}

export const addCalendarDays = (value: string, days: number) => { const date = asUtcDate(value); date.setUTCDate(date.getUTCDate() + days); return fromUtcDate(date) }

export const addCalendarMonths = (value: string, months: number) => {
  const { year, month, day } = dateParts(value)
  const first = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return fromUtcDate(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay))))
}

export const weekRange = (value: string): [string, string] => {
  const date = asUtcDate(value)
  const monday = addCalendarDays(value, -((date.getUTCDay() + 6) % 7))
  return [monday, addCalendarDays(monday, 6)]
}

export const monthRange = (value: string): [string, string] => {
  const { year, month } = dateParts(value)
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  return [start, fromUtcDate(new Date(Date.UTC(year, month, 0)))]
}

export const calendarDates = (start: string, end: string) => {
  const dates: string[] = []
  for (let date = start; date <= end; date = addCalendarDays(date, 1)) dates.push(date)
  return dates
}
