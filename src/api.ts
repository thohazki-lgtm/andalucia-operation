import type { AttendanceRecord, AuthenticatedUser, BillTipVersionDiff, BillTipVersionSnapshot, BillTipWorkflowState, BookingGuestMemberPreview, BookingImportPreview, BookingImportResult, BookingImportReviewChanges, BookingImportReviewDecision, BookingImportReviewValidation, BookingIntelligenceReanalysisPreview, BookingRecord, BookingSummary, ChargeableRecord, ChargeableSummary, ConfigOption, DailyReportManualPayload, DailyReportView, DatabaseAdminHealth, DatabaseBackupInventoryItem, FinancialManagerPreview, FinancialPreviewExternalAllocation, GuestExperienceView, GuestOccasionRecord, GuestOccasionSummary, MaintenanceDuplicateWarning, MaintenanceRecord, MaintenanceSummary, MonthlyFinancePayload, MonthlyReportView, OperationalReport, PublicHoliday, RecoveryPreview, ReportManagerSummary, ReportPeriodType, RosterEntry, Staff, StaffEntitlement, StaffEntitlementBalance, StaffLeaveRecord, StaffMembershipBaselineApprovalResult, StaffMembershipBaselineDiff, StaffMembershipBaselinePreview, StaffMembershipBaselineReview, StaffMembershipBaselineSelection, StaffMembershipBaselineStatusRead, StaffTrainingHistory, TrainingCompletionInput, TrainingDefaults, TrainingImportBatch, TrainingImportDecision, TrainingImportPreview, TrainingImportResult, TrainingPerformance, TrainingSession, TrainingSessionDetail, TrainingTargetVersion, TrainingWorkflowOption, WalkInBookingInput, WeeklyReportView, WineSpiritCalculation, WineSpiritSale, WineSpiritSaleInput } from './domain'
import type { ChargeableDuplicateWarning, ChargeableWriteRequest } from './domain'
import type { WineSpiritSaleWriteRequest } from './domain'
import type { LeavePlannerReadModel } from './domain'

async function request<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init }); if (!response.ok) { const error = await response.json().catch(() => ({})) as { message?: string }; throw new Error(error.message || 'The request could not be completed.') } if (response.status === 204) return undefined as T; const payload = await response.text(); return (payload ? JSON.parse(payload) : undefined) as T }
export const authApi = {
  bootstrapStatus: () => request<{ accountConfigured: boolean }>('/api/auth/bootstrap-status'),
  me: () => request<AuthenticatedUser>('/api/auth/me'),
  login: (identifier: string, password: string) => request<AuthenticatedUser>('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) })
}
export const databaseAdminApi = {
  health: () => request<DatabaseAdminHealth>('/api/database/health'),
  inventory: () => request<DatabaseBackupInventoryItem[]>('/api/database/backups'),
  requestBackup: () => request<{ id: string; state: string; requestedAt: string }>('/api/database/backups/request', { method: 'POST', body: JSON.stringify({}) }),
  pin: (backupId: string, pinned: boolean, reason = '') => request<DatabaseBackupInventoryItem>(`/api/database/backups/${encodeURIComponent(backupId)}/${pinned ? 'pin' : 'unpin'}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  inspect: (backupId: string) => request<DatabaseBackupInventoryItem>(`/api/database/backups/${encodeURIComponent(backupId)}/inspect`, { method: 'POST', body: JSON.stringify({}) }),
  rehearse: (backupId: string) => request<{ status: string; completedAt: string }>(`/api/database/backups/${encodeURIComponent(backupId)}/restore-rehearsal`, { method: 'POST', body: JSON.stringify({}) }),
  selectRecoveryCandidate: (incidentId: string, backupId: string) => request<RecoveryPreview>(`/api/database/recovery/incidents/${encodeURIComponent(incidentId)}/select`, { method: 'POST', body: JSON.stringify({ backupId }) }),
  recoveryPreview: (incidentId: string) => request<RecoveryPreview>(`/api/database/recovery/incidents/${encodeURIComponent(incidentId)}/preview`),
  rehearseRecovery: (incidentId: string) => request(`/api/database/recovery/incidents/${encodeURIComponent(incidentId)}/rehearse`, { method: 'POST', body: JSON.stringify({}) }),
  prepareRecoveryAuthorization: (incidentId: string, rollbackBackupId: string) => request(`/api/database/recovery/incidents/${encodeURIComponent(incidentId)}/authorize`, { method: 'POST', body: JSON.stringify({ rollbackBackupId, confirmation: 'YES_I_AUTHORIZE_ANDALUCIA_RECOVERY_PREPARATION' }) }),
  acceptRecovery: (incidentId: string) => request(`/api/database/recovery/incidents/${encodeURIComponent(incidentId)}/accept`, { method: 'POST', body: JSON.stringify({}) })
}
export const staffApi = {
  list: () => request<Staff[]>('/api/staff'),
  create: (staff: Staff) => request<Staff>('/api/staff', { method: 'POST', body: JSON.stringify(staff) }),
  update: (staff: Staff) => request<Staff>(`/api/staff/${staff.id}`, { method: 'PUT', body: JSON.stringify(staff) }),
  configuration: () => request<{ dutyCodes: ConfigOption[]; employmentStatuses: ConfigOption[]; positions: ConfigOption[] }>('/api/config/staff'),
  leavePlanner: (month: string) => request<LeavePlannerReadModel>(`/api/workforce/leave-planner?month=${encodeURIComponent(month)}`),
  correctPublicHolidaySemantics: () => request<{ changed: boolean; option: ConfigOption }>('/api/workforce/leave-planner/ph-semantics', { method: 'POST', body: JSON.stringify({}) }),
  leaveRecords: (start: string, end: string, staffId?: string) => request<StaffLeaveRecord[]>(`/api/staff/leave-records?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${staffId ? `&staffId=${encodeURIComponent(staffId)}` : ''}`),
  entitlements: () => request<StaffEntitlement[]>('/api/workforce/staff-entitlements'),
  saveEntitlement: (entitlement: StaffEntitlement) => request<StaffEntitlement>(`/api/workforce/staff-entitlements/${entitlement.staffId}`, { method: 'PUT', body: JSON.stringify(entitlement) }),
  entitlementBalance: (staffId: string, year: number, weekDate: string) => request<StaffEntitlementBalance>(`/api/workforce/staff-entitlements/${staffId}/balance?year=${year}&weekDate=${weekDate}`),
  publicHolidays: (year: number) => request<PublicHoliday[]>(`/api/workforce/public-holidays?year=${year}`),
  createPublicHoliday: (holiday: PublicHoliday) => request<PublicHoliday>('/api/workforce/public-holidays', { method: 'POST', body: JSON.stringify(holiday) }),
  updatePublicHoliday: (holiday: PublicHoliday) => request<PublicHoliday>(`/api/workforce/public-holidays/${holiday.id}`, { method: 'PUT', body: JSON.stringify(holiday) }),
  removePublicHoliday: (id: string) => request<void>(`/api/workforce/public-holidays/${id}`, { method: 'DELETE' }),
  saveConfiguration: (group: 'duty-codes' | 'employment-statuses' | 'positions', option: ConfigOption) => request<ConfigOption>(`/api/config/staff/${group}/${option.id}`, { method: 'PUT', body: JSON.stringify(option) }),
  reorderDutyCode: (id: string, direction: 'up' | 'down') => request<ConfigOption[]>('/api/config/staff/duty-codes/reorder', { method: 'POST', body: JSON.stringify({ id, direction }) }),
  removeDutyCode: (id: string) => request<{ mode: 'deleted' | 'retired'; option?: ConfigOption }>(`/api/config/staff/duty-codes/${id}`, { method: 'DELETE' })
}
export const staffMembershipBaselineApi = {
  preview: (month = '2026-09', outletScopeKey = 'andalucia') => request<StaffMembershipBaselinePreview>(`/api/staff-membership/baselines/${outletScopeKey}/${month}/preview`),
  status: (month = '2026-09', outletScopeKey = 'andalucia') => request<StaffMembershipBaselineStatusRead>(`/api/staff-membership/baselines/${outletScopeKey}/${month}/status`),
  beginReview: (month = '2026-09', outletScopeKey = 'andalucia') => request<StaffMembershipBaselineReview>('/api/staff-membership/baseline-reviews', { method: 'POST', body: JSON.stringify({ month, outletScopeKey }) }),
  saveSelection: (reviewId: string, selection: StaffMembershipBaselineSelection) => request<StaffMembershipBaselineSelection>(`/api/staff-membership/baseline-reviews/${reviewId}/selections/${selection.staffId}`, { method: 'PUT', body: JSON.stringify(selection) }),
  removeSelection: (reviewId: string, staffId: string) => request<void>(`/api/staff-membership/baseline-reviews/${reviewId}/selections/${staffId}`, { method: 'DELETE' }),
  approve: (reviewId: string) => request<StaffMembershipBaselineApprovalResult>(`/api/staff-membership/baseline-reviews/${reviewId}/approve`, { method: 'POST', body: JSON.stringify({}) }),
  reset: (reviewId: string, reason: string) => request<{ reset: true }>(`/api/staff-membership/baseline-reviews/${reviewId}/reset`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reopen: (reviewId: string, outletScopeId: string, month: string, reason: string) => request<StaffMembershipBaselineReview>(`/api/staff-membership/baseline-reviews/${reviewId}/reopen`, { method: 'POST', body: JSON.stringify({ outletScopeId, month, reason }) }),
  history: (month = '2026-09', outletScopeKey = 'andalucia') => request<StaffMembershipBaselineReview[]>(`/api/staff-membership/baselines/${outletScopeKey}/${month}/history`),
  diff: (reviewId: string) => request<StaffMembershipBaselineDiff | null>(`/api/staff-membership/baseline-reviews/${reviewId}/diff`)
}
export const operationsApi = {
  roster: (start: string, end: string) => request<RosterEntry[]>(`/api/roster?start=${start}&end=${end}`),
  updateRoster: (staffId: string, date: string, dutyCode: string) => request<void>(`/api/roster/${staffId}/${date}`, { method: 'PUT', body: JSON.stringify({ dutyCode }) }),
  attendance: (start: string, end: string) => request<AttendanceRecord[]>(`/api/attendance?start=${start}&end=${end}`),
  saveAttendance: (record: AttendanceRecord) => request<void>(`/api/attendance/${record.staffId}/${record.date}`, { method: 'PUT', body: JSON.stringify(record) }),
  attendanceStatuses: () => request<ConfigOption[]>('/api/config/attendance-statuses'),
  createAttendanceStatus: (option: ConfigOption) => request<ConfigOption>('/api/config/attendance-statuses', { method: 'POST', body: JSON.stringify(option) }),
  updateAttendanceStatus: (option: ConfigOption) => request<ConfigOption>(`/api/config/attendance-statuses/${option.id}`, { method: 'PUT', body: JSON.stringify(option) })
}
export const trainingApi = {
  list: () => request<TrainingSession[]>('/api/training'),
  performance: (month: string) => request<TrainingPerformance>(`/api/training/performance?month=${encodeURIComponent(month)}`),
  detail: (id: string) => request<TrainingSessionDetail>(`/api/training/${encodeURIComponent(id)}/r2-detail`),
  confirm: (id: string, input: TrainingCompletionInput) => request<TrainingSessionDetail>(`/api/training/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify(input) }),
  create: (training: TrainingSession) => request<TrainingSession>('/api/training', { method: 'POST', body: JSON.stringify(training) }),
  update: (training: TrainingSession) => request<TrainingSession>(`/api/training/${training.id}`, { method: 'PUT', body: JSON.stringify(training) }),
  archive: (id: string) => request<TrainingSession>(`/api/training/${id}`, { method: 'DELETE' }),
  previewImport: async (file: File): Promise<TrainingImportPreview> => { const response = await fetch(`/api/training/import-preview?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }); if (!response.ok) { const error = await response.json().catch(() => ({})) as { message?: string }; throw new Error(error.message || 'The HR calendar could not be parsed.') } return response.json() as Promise<TrainingImportPreview> },
  confirmImport: (batchId: string, decisions: TrainingImportDecision[]) => request<TrainingImportResult>('/api/training/confirm-import', { method: 'POST', body: JSON.stringify({ batchId, decisions }) }),
  importBatch: (id: string) => request<TrainingImportBatch>(`/api/training/import-batches/${id}`),
  removeImportBatch: (id: string) => request<TrainingImportResult>(`/api/training/import-batches/${id}`, { method: 'DELETE' }),
  replaceImport: (batchId: string, existingBatchId: string, decisions: TrainingImportDecision[]) => request<TrainingImportResult>('/api/training/replace-import', { method: 'POST', body: JSON.stringify({ batchId, existingBatchId, decisions }) }),
  saveAttendance: (trainingId: string, attendance: Array<{ staffId: string; attendanceStatus: string | null }>) => request<TrainingSession>(`/api/training/${trainingId}/attendance`, { method: 'PUT', body: JSON.stringify({ attendance }) }),
  staffHistory: (staffId: string) => request<StaffTrainingHistory[]>(`/api/staff/${staffId}/training-history`),
  configuration: () => request<{ categories: ConfigOption[]; statuses: ConfigOption[]; attendanceStatuses: ConfigOption[]; defaults: TrainingDefaults; target: TrainingTargetVersion; workflow: TrainingWorkflowOption[] }>('/api/config/training'),
  saveCategory: (option: ConfigOption) => request<ConfigOption>(`/api/config/training/categories/${option.id}`, { method: 'PUT', body: JSON.stringify(option) }),
  reorderCategory: (id: string, direction: 'up' | 'down') => request<ConfigOption[]>('/api/config/training/categories/reorder', { method: 'POST', body: JSON.stringify({ id, direction }) }),
  reorderCategories: (orderedIds: string[]) => request<ConfigOption[]>('/api/config/training/categories/order', { method: 'PUT', body: JSON.stringify({ orderedIds }) }),
  saveDefaults: (defaults: TrainingDefaults) => request<TrainingDefaults>('/api/config/training/defaults', { method: 'PUT', body: JSON.stringify(defaults) }),
  createTargetVersion: (input: { effectiveMonth: string; monthlyTargetHours: number; perHeadTargetHours: number }) => request<TrainingTargetVersion>('/api/config/training/targets', { method: 'POST', body: JSON.stringify(input) }),
  saveWorkflowColor: (state: TrainingWorkflowOption['state'], color: string) => request<TrainingWorkflowOption>(`/api/config/training/workflow/${state}`, { method: 'PUT', body: JSON.stringify({ color }) })
}
export const bookingApi = {
  list: (date: string) => request<BookingRecord[]>(`/api/bookings?date=${date}`),
  summary: (date: string) => request<BookingSummary>(`/api/bookings/summary?date=${date}`),
  create: (booking: BookingRecord) => request<BookingRecord>('/api/bookings', { method: 'POST', body: JSON.stringify(booking) }),
  createWalkIn: (booking: WalkInBookingInput) => request<BookingRecord>('/api/bookings/walk-in', { method: 'POST', body: JSON.stringify(booking) }),
  update: (booking: BookingRecord) => request<BookingRecord>(`/api/bookings/${booking.id}`, { method: 'PUT', body: JSON.stringify(booking) }),
  configuration: () => request<{ statuses: ConfigOption[]; sources: ConfigOption[]; tables: ConfigOption[]; tableRanges: ConfigOption[]; walkInFields: ConfigOption[] }>('/api/config/bookings'),
  saveConfiguration: (group: 'statuses' | 'sources' | 'tables' | 'tableRanges' | 'walkInFields', option: ConfigOption) => { const path = group === 'tableRanges' ? 'table-ranges' : group === 'walkInFields' ? 'walk-in-fields' : group; return request<ConfigOption>(`/api/config/bookings/${path}/${option.id}`, { method: 'PUT', body: JSON.stringify(option) }) },
  resetWalkInFields: () => request<ConfigOption[]>('/api/config/bookings/walk-in-fields/reset', { method: 'POST', body: JSON.stringify({}) }),
  previewActivityProgram: async (file: File): Promise<BookingImportPreview> => { const response = await fetch(`/api/bookings/import-preview?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file }); if (!response.ok) { const error = await response.json().catch(() => ({})) as { message?: string }; throw new Error(error.message || 'The Activity Program could not be parsed.') } return response.json() as Promise<BookingImportPreview> },
  reanalyzeImportPreview: (batchId: string) => request<BookingIntelligenceReanalysisPreview>('/api/bookings/reanalyze-import-preview', { method: 'POST', body: JSON.stringify({ batchId }) }),
  validateImportReview: (batchId: string, index: number, changes: BookingImportReviewChanges) => request<BookingImportReviewValidation>('/api/bookings/validate-import-review', { method: 'POST', body: JSON.stringify({ batchId, index, changes }) }),
  confirmImport: (batchId: string, selectedIndexes: number[], reviewDecisions: BookingImportReviewDecision[] = []) => request<BookingImportResult>('/api/bookings/confirm-import', { method: 'POST', body: JSON.stringify({ batchId, selectedIndexes, reviewDecisions }) }),
  guestMembers: (bookingId: string) => request<BookingGuestMemberPreview[]>(`/api/bookings/${bookingId}/guest-members`)
}
export const chargeableApi = {
  list: (date: string) => request<ChargeableRecord[]>(`/api/chargeables?date=${date}`),
  summary: (date: string) => request<ChargeableSummary>(`/api/chargeables/summary?date=${date}`),
  create: (record: ChargeableWriteRequest) => request<ChargeableRecord>('/api/chargeables', { method: 'POST', body: JSON.stringify(record) }),
  update: (record: ChargeableWriteRequest) => request<ChargeableRecord>(`/api/chargeables/${record.id}`, { method: 'PUT', body: JSON.stringify(record) }),
  duplicateReview: (record: ChargeableWriteRequest) => request<ChargeableDuplicateWarning[]>('/api/chargeables/duplicate-review', { method: 'POST', body: JSON.stringify(record) }),
  archive: (id: string) => request<ChargeableRecord>(`/api/chargeables/${id}`, { method: 'DELETE' }),
  configuration: () => request<{ items: ConfigOption[]; statuses: ConfigOption[]; wineCatalog?: ConfigOption[] }>('/api/config/chargeables'),
  saveConfiguration: (group: 'items' | 'statuses' | 'wine-catalog', option: ConfigOption) => request<ConfigOption>(`/api/config/chargeables/${group}/${option.id}`, { method: 'PUT', body: JSON.stringify(option) })
}
export const wineSpiritsApi = {
  list: (start: string, end: string) => request<WineSpiritSale[]>(`/api/wine-spirits?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
  calculate: (input: WineSpiritSaleInput) => request<WineSpiritCalculation>('/api/wine-spirits/calculate', { method: 'POST', body: JSON.stringify(input) }),
  duplicateReview: (input: WineSpiritSaleInput) => request<Array<{ id: string; checkInvoiceNumber: string; itemName: string }>>('/api/wine-spirits/duplicate-review', { method: 'POST', body: JSON.stringify(input) }),
  create: (input: WineSpiritSaleWriteRequest) => request<WineSpiritSale>('/api/wine-spirits', { method: 'POST', body: JSON.stringify(input) }),
  update: (input: WineSpiritSaleWriteRequest) => request<WineSpiritSale>(`/api/wine-spirits/${encodeURIComponent(input.id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  archive: (id: string, correctionReason = '') => request<WineSpiritSale>(`/api/wine-spirits/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ correctionReason }) }),
  audit: (id: string) => request<Array<{ id: string; action: string; actor: string; createdAt: string; before: Record<string, unknown>; after: Record<string, unknown> }>>(`/api/wine-spirits/${encodeURIComponent(id)}/audit`),
}
export const financialPreviewApi = {
  preview: (month: string, totalPool: string, externalAllocations: FinancialPreviewExternalAllocation[]) => request<FinancialManagerPreview>('/api/financial-preview', { method: 'POST', body: JSON.stringify({ month, totalPool, externalAllocations }) })
}
export const billTipWorkflowApi = {
  state: (month: string) => request<BillTipWorkflowState>(`/api/bill-tips/workflow?month=${encodeURIComponent(month)}`),
  version: (id: string) => request<BillTipVersionSnapshot>(`/api/bill-tips/versions/${encodeURIComponent(id)}`),
  diff: (id: string) => request<BillTipVersionDiff | null>(`/api/bill-tips/versions/${encodeURIComponent(id)}/diff`),
  finalize: (input: { month: string; totalPool: string; externalAllocations: FinancialPreviewExternalAllocation[]; backupId: string; confirmation: string; idempotencyKey: string }) => request<BillTipVersionSnapshot>('/api/bill-tips/finalize', { method: 'POST', body: JSON.stringify(input) }),
  reopen: (id: string, reason: string, correctionKey: string, confirmation: string) => request<BillTipVersionSnapshot>(`/api/bill-tips/versions/${encodeURIComponent(id)}/reopen`, { method: 'POST', body: JSON.stringify({ reason, correctionKey, confirmation }) }),
  refinalize: (id: string, input: { totalPool: string; externalAllocations: FinancialPreviewExternalAllocation[]; backupId: string; confirmation: string; idempotencyKey: string }) => request<BillTipVersionSnapshot>(`/api/bill-tips/versions/${encodeURIComponent(id)}/refinalize`, { method: 'POST', body: JSON.stringify(input) })
}
export const guestOccasionApi = {
  experience: (date: string) => request<GuestExperienceView>(`/api/guest-experience?date=${date}`),
  list: (date: string) => request<GuestOccasionRecord[]>(`/api/guest-occasions?date=${date}`),
  summary: (date: string) => request<GuestOccasionSummary>(`/api/guest-occasions/summary?date=${date}`),
  create: (record: GuestOccasionRecord) => request<GuestOccasionRecord>('/api/guest-occasions', { method: 'POST', body: JSON.stringify(record) }),
  update: (record: GuestOccasionRecord) => request<GuestOccasionRecord>(`/api/guest-occasions/${record.id}`, { method: 'PUT', body: JSON.stringify(record) }),
  detectForBooking: (bookingId: string) => request<GuestOccasionRecord[]>(`/api/guest-occasions/detect/${bookingId}`, { method: 'POST' }),
  configuration: () => request<{ types: ConfigOption[]; statuses: ConfigOption[] }>('/api/config/guest-occasions'),
  saveConfiguration: (group: 'types' | 'statuses', option: ConfigOption) => request<ConfigOption>(`/api/config/guest-occasions/${group}/${option.id}`, { method: 'PUT', body: JSON.stringify(option) })
}
export const maintenanceApi = {
  list: () => request<MaintenanceRecord[]>('/api/maintenance'),
  summary: (date: string) => request<MaintenanceSummary>(`/api/maintenance/summary?date=${date}`),
  create: (record: MaintenanceRecord) => request<MaintenanceRecord>('/api/maintenance', { method: 'POST', body: JSON.stringify(record) }),
  update: (record: MaintenanceRecord) => request<MaintenanceRecord>(`/api/maintenance/${record.id}`, { method: 'PUT', body: JSON.stringify(record) }),
  duplicateReview: (record: MaintenanceRecord) => request<MaintenanceDuplicateWarning[]>('/api/maintenance/duplicate-review', { method: 'POST', body: JSON.stringify(record) }),
  configuration: () => request<{ areas: ConfigOption[]; statuses: ConfigOption[] }>('/api/config/maintenance'),
  saveConfiguration: (group: 'areas' | 'statuses', option: ConfigOption) => request<ConfigOption>(`/api/config/maintenance/${group}/${option.id}`, { method: 'PUT', body: JSON.stringify(option) })
}
export const reportingApi = {
  report: (periodType: ReportPeriodType, startDate: string, endDate: string) => request<OperationalReport>(`/api/reports?periodType=${periodType}&start=${startDate}&end=${endDate}`),
  saveManagerSummary: (summary: ReportManagerSummary) => request<ReportManagerSummary>('/api/reports/manager-summary', { method: 'PUT', body: JSON.stringify(summary) })
}
export const dailyReportingApi = {
  view: (date: string) => request<DailyReportView>(`/api/reports/daily?date=${encodeURIComponent(date)}`),
  saveDraft: (date: string, manualPayload: DailyReportManualPayload) => request<DailyReportView>(`/api/reports/daily/${encodeURIComponent(date)}/draft`, { method: 'PUT', body: JSON.stringify({ manualPayload }) }),
  review: (date: string) => request<DailyReportView>(`/api/reports/daily/${encodeURIComponent(date)}/review`, { method: 'POST', body: JSON.stringify({}) }),
  approve: (date: string, idempotencyKey: string) => request<DailyReportView>(`/api/reports/daily/${encodeURIComponent(date)}/approve`, { method: 'POST', body: JSON.stringify({ idempotencyKey }) }),
}
export const weeklyReportingApi = {
  view: (date: string) => request<WeeklyReportView>(`/api/reports/weekly?date=${encodeURIComponent(date)}`),
  saveCommentary: (weekStart: string, managerNotes: string) => request<WeeklyReportView>(`/api/reports/weekly/${encodeURIComponent(weekStart)}/commentary`, { method: 'PUT', body: JSON.stringify({ managerNotes }) }),
}
export const monthlyReportingApi = {
  view: (month: string) => request<MonthlyReportView>(`/api/reports/monthly?month=${encodeURIComponent(month)}`),
  save: (month: string, input: { expectedRevision: number | null; financePayload: MonthlyFinancePayload; managerCommentary: string; followUpsChanges: string }) => request<MonthlyReportView>(`/api/reports/monthly/${encodeURIComponent(month)}`, { method: 'PUT', body: JSON.stringify(input) }),
  verify: (month: string, expectedRevision: number) => request<MonthlyReportView>(`/api/reports/monthly/${encodeURIComponent(month)}/verify`, { method: 'POST', body: JSON.stringify({ expectedRevision }) }),
}
