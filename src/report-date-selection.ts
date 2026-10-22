import { serviceDate } from './service-date'

export const legacyDailyReportDateKey = 'andalucia.reports.daily-date'

export const currentMaldivesReportDate = (now = new Date()) => serviceDate(now)

export const clearLegacyDailyReportDate = (storage: Pick<Storage, 'removeItem'> | undefined = typeof window === 'undefined' ? undefined : window.sessionStorage) => {
  try { storage?.removeItem(legacyDailyReportDateKey) } catch { /* Browser storage is optional. */ }
}
