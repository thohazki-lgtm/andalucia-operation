import type { DailyReportManualPayload } from './domain'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export const blankDailyReportManualPayload = (): DailyReportManualPayload => ({
  symphony: { foodRevenue: '', beverageRevenue: '', wineRevenue: '', liquorRevenue: '', totalSale: '', totalDiscount: '', totalVoid: '', netSale: '', totalRevenue: '', voidDetails: [] },
  serviceVerification: { doubleDinePax: null, details: [] },
  serviceCharges: { amount: '', remarks: '' },
  manager: { operationSummary: '', operatingSummary: '', operationsIssues: '', keyOperationalIssue: '', guestFeedbackServiceRecovery: '', followUpRequired: '' },
  revenueVerification: { acknowledged: false },
})

export const hydrateDailyReportManualPayload = (value: unknown): DailyReportManualPayload => {
  const blank = blankDailyReportManualPayload()
  const input = record(value)
  const symphony = record(input.symphony)
  const serviceVerification = record(input.serviceVerification)
  const serviceCharges = record(input.serviceCharges)
  const manager = record(input.manager)
  const revenueVerification = record(input.revenueVerification)

  return {
    symphony: {
      ...blank.symphony,
      ...symphony,
      voidDetails: Array.isArray(symphony.voidDetails) ? symphony.voidDetails as DailyReportManualPayload['symphony']['voidDetails'] : [],
    },
    serviceVerification: {
      ...blank.serviceVerification,
      ...serviceVerification,
      details: Array.isArray(serviceVerification.details) ? serviceVerification.details as DailyReportManualPayload['serviceVerification']['details'] : [],
    },
    serviceCharges: { ...blank.serviceCharges, ...serviceCharges },
    manager: { ...blank.manager, ...manager },
    revenueVerification: { ...blank.revenueVerification, ...revenueVerification },
  } as DailyReportManualPayload
}
