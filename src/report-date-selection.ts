import { serviceDate } from './service-date'

export const legacyDailyReportDateKey = 'andalucia.reports.daily-date'
export const dailyReportDateParameter = 'dailyReportDate'

export const currentMaldivesReportDate = (now = new Date()) => serviceDate(now)

const validDate = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()))

export const initialDailyReportDate = (search = typeof window === 'undefined' ? '' : window.location.search, now = new Date()) => {
  const selected = new URLSearchParams(search).get(dailyReportDateParameter)
  return validDate(selected) ? selected! : currentMaldivesReportDate(now)
}

export const dailyReportUrlForDate = (href: string, date: string) => {
  const url = new URL(href)
  if (validDate(date)) url.searchParams.set(dailyReportDateParameter, date)
  return `${url.pathname}${url.search}${url.hash}`
}

export const clearLegacyDailyReportDate = (storage: Pick<Storage, 'removeItem'> | undefined = typeof window === 'undefined' ? undefined : window.sessionStorage) => {
  try { storage?.removeItem(legacyDailyReportDateKey) } catch { /* Browser storage is optional. */ }
}
