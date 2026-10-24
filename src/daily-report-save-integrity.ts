import type { DailyReportManualPayload } from './domain'

type ManagerReview = Pick<DailyReportManualPayload['manager'], 'operatingSummary' | 'operationsIssues'>
type ServiceCharges = DailyReportManualPayload['serviceCharges']

const normalizedReportText = (value: unknown) => String(value ?? '').trim().slice(0, 10_000)
const normalizedServiceChargeAmount = (value: unknown) => {
  const amount = String(value ?? '').trim()
  return amount && /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount) ? Number(amount).toFixed(2) : amount
}

export const managerReviewWasPersisted = (submitted: ManagerReview, returned?: Partial<ManagerReview> | null) => Boolean(
  returned
  && normalizedReportText(returned.operatingSummary) === normalizedReportText(submitted.operatingSummary)
  && normalizedReportText(returned.operationsIssues) === normalizedReportText(submitted.operationsIssues),
)

export const serviceChargesWerePersisted = (submitted: ServiceCharges, returned?: Partial<ServiceCharges> | null) => Boolean(
  returned
  && normalizedServiceChargeAmount(returned.amount) === normalizedServiceChargeAmount(submitted.amount)
  && String(returned.remarks ?? '').trim().slice(0, 1000) === String(submitted.remarks ?? '').trim().slice(0, 1000),
)
