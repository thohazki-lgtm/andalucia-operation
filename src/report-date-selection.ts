import { serviceDate } from './service-date'

export const legacyDailyReportDateKey = 'andalucia.reports.daily-date'
export const dailyReportDateStorageKey = 'andalucia.reports.daily.selected-date.v1'
export const dailyReportDateParameter = 'dailyReportDate'

export const currentMaldivesReportDate = (now = new Date()) => serviceDate(now)

const validDate = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

type DailyReportDateStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const browserLocalStorage = () => typeof window === 'undefined' ? undefined : window.localStorage

export const storedDailyReportDate = (storage: DailyReportDateStorage | undefined = browserLocalStorage()) => {
  try {
    const stored = storage?.getItem(dailyReportDateStorageKey) ?? null
    if (validDate(stored)) return stored
    if (stored !== null) storage?.removeItem(dailyReportDateStorageKey)
  } catch { /* Browser storage is optional. */ }
  return null
}

export const persistDailyReportDate = (date: string, storage: DailyReportDateStorage | undefined = browserLocalStorage()) => {
  if (!validDate(date)) return false
  try { storage?.setItem(dailyReportDateStorageKey, date); return true } catch { return false }
}

export const initialDailyReportDate = (_search = typeof window === 'undefined' ? '' : window.location.search, now = new Date(), storage: DailyReportDateStorage | undefined = browserLocalStorage()) => {
  try { storage?.removeItem(dailyReportDateStorageKey) } catch { /* Browser storage is optional. */ }
  return currentMaldivesReportDate(now)
}

export const dailyReportUrlForDate = (href: string, date: string) => {
  const url = new URL(href)
  if (validDate(date)) url.searchParams.set(dailyReportDateParameter, date)
  return `${url.pathname}${url.search}${url.hash}`
}

export const dailyReportUrlWithoutDate = (href: string) => {
  const url = new URL(href)
  url.searchParams.delete(dailyReportDateParameter)
  return `${url.pathname}${url.search}${url.hash}`
}

export const clearPersistedDailyReportDate = (storage: Pick<Storage, 'removeItem'> | undefined = browserLocalStorage()) => {
  try { storage?.removeItem(dailyReportDateStorageKey) } catch { /* Browser storage is optional. */ }
}

export const clearLegacyDailyReportDate = (storage: Pick<Storage, 'removeItem'> | undefined = typeof window === 'undefined' ? undefined : window.sessionStorage) => {
  try { storage?.removeItem(legacyDailyReportDateKey) } catch { /* Browser storage is optional. */ }
}
