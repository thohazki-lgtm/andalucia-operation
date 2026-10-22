import type { DailyReportManualPayload } from './domain'

type ManagerReview = Pick<DailyReportManualPayload['manager'], 'operatingSummary' | 'operationsIssues'>

const normalizedReportText = (value: unknown) => String(value ?? '').trim().slice(0, 10_000)

export const managerReviewWasPersisted = (submitted: ManagerReview, returned?: Partial<ManagerReview> | null) => Boolean(
  returned
  && normalizedReportText(returned.operatingSummary) === normalizedReportText(submitted.operatingSummary)
  && normalizedReportText(returned.operationsIssues) === normalizedReportText(submitted.operationsIssues),
)
