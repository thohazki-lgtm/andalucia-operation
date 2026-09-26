export type ConfigGroup = 'dutyCodes' | 'employmentStatuses' | 'attendanceStatuses' | 'bookingStatuses' | 'bookingSources' | 'restaurantTables' | 'restaurantTableRanges' | 'bookingWalkInFields' | 'positions' | 'chargeableItems' | 'chargeableStatuses' | 'wineSpiritCatalog' | 'occasionTypes' | 'occasionStatuses' | 'maintenanceAreas' | 'maintenanceStatuses' | 'trainingTypes' | 'trainingCategories' | 'trainingStatuses' | 'trainingAttendanceStatuses'
export type WalkInFieldMode = 'required' | 'optional' | 'hidden' | 'system'
export interface ConfigOption { id: string; value: string; label: string; color?: string; active: boolean; sortOrder?: number; metadata?: { displayCode?: string; countsAsWorking?: boolean; billTipEligible?: boolean; billTipWorkedDayUnits?: number; dutyClassification?: 'working' | 'off' | 'annualLeave' | 'publicHoliday' | 'sickLeave' | 'other'; countsAsLeave?: boolean; countsAsOffDay?: boolean; countsAsPublicHoliday?: boolean; countsAsSickLeave?: boolean; countsAsException?: boolean; eligibleForAssignments?: boolean; serviceAssignmentEligible?: boolean; employmentStage?: 'active' | 'temporarilyUnavailable' | 'inactive'; price?: number; category?: string; description?: string; trainingStage?: 'planned' | 'upcoming' | 'completed' | 'cancelled'; trainingAttendanceOutcome?: 'attended' | 'absent' | 'excused' | 'other'; bookingMetric?: 'arrived' | 'noShow'; excludesFromExpectedCovers?: boolean; serviceStage?: 'remaining' | 'arrived' | 'completed' | 'noShow' | 'excluded'; operationalAction?: 'waiting' | 'arrived' | 'noShow'; systemControlled?: boolean; protected?: boolean; manualOnly?: boolean; walkInFieldMode?: WalkInFieldMode; recommendedMode?: WalkInFieldMode; tableRangeStart?: number; tableRangeEnd?: number; chargeableStage?: 'pending' | 'charged' | 'cancelled'; countsAsRealizedRevenue?: boolean; countsAsPendingValue?: boolean; excludesFromChargeableTotals?: boolean; detectionKeywords?: string[]; defaultStatus?: string; countsAsOccasionAttention?: boolean; occasionStage?: 'active' | 'completed'; occasionWorkflow?: 'attention' | 'prepared' | 'completed'; occasionCategory?: 'honeymoon' | 'birthday' | 'anniversary' | 'seeYouSoon' | 'siyamFamily' | 'famtrip' | 'presstrip' | 'other'; countsAsVipSpecial?: boolean; maintenanceStage?: 'open' | 'inProgress' | 'completed'; outletScopeId?: string; durationMinutes?: number; trainerMode?: 'venue_manager' | 'staff'; trainerStaffId?: string | null; location?: string; categoryValue?: string | null; participantSelection?: 'eligible_staff'; workflowState?: TrainingOperationalStatus } }
export type Configuration = Record<ConfigGroup, ConfigOption[]>
export interface Staff { id: string; name: string; number: string; position: string; joinDate: string; nationality: string; division: string; department: string; outlet: string; identityDocumentNumber: string; employmentStatus: string; assignmentEligible?: boolean; serviceAssignmentEligible?: boolean; resignationDate?: string; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export type UserAccountStatus = 'active' | 'disabled'
export type AuthorizationRoleKey = 'owner' | 'outlet_manager' | 'operational_user' | 'viewer'
export type AuthorizationPermissionKey =
  | 'manage_platform' | 'manage_outlets' | 'manage_users' | 'manage_roles_permissions'
  | 'manage_staff' | 'manage_staff_membership' | 'manage_staff_membership_baseline'
  | 'approve_staff_membership_baseline' | 'reopen_staff_membership_baseline'
  | 'manage_duty_roster' | 'manage_training' | 'manage_bookings' | 'manage_guest_occasions'
  | 'manage_chargeables' | 'manage_maintenance' | 'manage_bill_tips' | 'manage_incentives'
  | 'manage_financial_rules' | 'view_reports' | 'manage_reports' | 'view_audit_history'
  | 'perform_financial_corrections'
export interface AuthorizationSummary { roleKeys: AuthorizationRoleKey[]; permissionKeys: AuthorizationPermissionKey[]; globalScope: boolean; allowedOutletScopeIds: string[]; isOwner: boolean }
export interface UserAccountIdentity { userId: string; loginIdentifier: string; displayName: string; status: UserAccountStatus; staffId: string | null }
export interface AuthenticatedUser extends UserAccountIdentity, AuthorizationSummary {}
export interface AuditActor { userId: string; displayName: string }
export interface AuthPrincipal extends AuditActor, AuthorizationSummary { sessionId: string; loginIdentifier: string; staffId: string | null }
export type DatabaseHealthState = 'HEALTHY' | 'BACKUP_RECOMMENDED' | 'MIGRATION_REQUIRED' | 'DATABASE_RECOVERY_REQUIRED' | 'BACKUP_INVALID' | 'STORE_CONFIGURATION_ERROR'
export type BackupRestoreTestStatus = 'RESTORE_TEST_PENDING' | 'RESTORE_TEST_PASSED' | 'RESTORE_TEST_FAILED'
export interface DatabaseBackupInventoryItem { backupId: string; category: string; createdAt: string; verificationStatus: 'VERIFIED' | 'INVALID' | 'VERIFYING'; schemaVersion: string; sizeBytes: number; protected: boolean; protectionReasons: string[]; restoreTestStatus: BackupRestoreTestStatus; latestRestoreTestAt: string | null; operationalFingerprint: Record<string, unknown> | null }
export interface DatabaseBackupPolicy { version: string; backupAgeWarningHours: number; restoreRehearsalIntervalDays: number; retention: { daily: number; weekly: number }; schedule: { dailyLocalTime: string; weeklyDay: string; weeklyLocalTime: string; restoreWeeklyDay: string; restoreLocalTime: string } }
export type RecoveryIncidentState = 'RECOVERY_REQUIRED' | 'CANDIDATE_SELECTED' | 'REHEARSAL_PASSED' | 'AUTHORIZED' | 'PROMOTION_IN_PROGRESS' | 'RECOVERY_PROMOTED_AWAITING_ACCEPTANCE' | 'RECOVERY_ACCEPTED' | 'ROLLBACK_COMPLETED' | 'RECOVERY_FAILED'
export interface RecoveryIncidentSummary { id: string; detectedAt: string; failureClass: string; state: RecoveryIncidentState; selectedBackupId: string | null; rehearsalStatus: string | null; promotionStatus: string | null; rollbackStatus: string | null; acceptedAt: string | null; acceptedBy: string | null }
export interface RecoveryGap { area: string; latestKnown: unknown; candidate: unknown; changed: boolean; material: boolean }
export interface RecoveryPreview { incident: { id: string; state: RecoveryIncidentState; selectedBackupId: string | null; gapAnalysis: RecoveryGap[] }; selectedCandidate: null | { backupId: string; createdAt: string; category: string; schemaVersion: string; verificationStatus: string; restoreTestStatus: string; protected: boolean }; gaps: RecoveryGap[]; materialGapCount: number }
export interface DatabaseRecoverySummary { required: boolean; activeIncident: null | RecoveryPreview['incident']; candidates: Array<{ backupId: string; createdAt: string; category: string; schemaVersion: string; verificationStatus: string; restoreTestStatus: string; protected: boolean; recoveryScore: number }>; history: RecoveryIncidentSummary[] }
export interface DatabaseAdminHealth { database: { status: DatabaseHealthState; storeId: string; storeRole: string; migrationVersion: string; migrationRequired: boolean; recoveryRequired: boolean; lastVerifiedBackup: null | { backupId: string; createdAt: string; category: string; verificationStatus: string; preflightStatus: string }; checks: Array<{ name: string; status: 'pass' | 'warning'; detail: string }> }; policy: DatabaseBackupPolicy; inventory: DatabaseBackupInventoryItem[]; storage: { totalBackupStorageBytes: number; backupCount: number; verifiedBackupCount: number; oldestVerifiedAt: string | null; newestVerifiedAt: string | null }; pendingBackupRequest: null | { id: string; state: string; requestedAt: string; requestedBy: { userId: string; displayName: string } }; lastVerifiedBackup: DatabaseBackupInventoryItem | null; lastRestoreTest: DatabaseBackupInventoryItem | null; recoveryReadiness: 'READY' | 'ATTENTION_REQUIRED'; warnings: string[]; recoveryCandidates: Array<DatabaseBackupInventoryItem & { recoveryScore: number }>; recovery: DatabaseRecoverySummary }
export interface AuthorizationRole { id: string; key: AuthorizationRoleKey; displayName: string; active: boolean; globalScope: boolean }
export interface AuthorizationPermission { id: string; key: AuthorizationPermissionKey; displayName: string; description: string; active: boolean }
export type OutletType = 'restaurant' | 'bar' | 'lounge' | 'cafe' | 'pool_bar' | 'beach_club' | 'other'
export interface OutletScope { id: string; scopeKey: string; displayName: string; active: boolean; outletType?: OutletType | null; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export type StaffMembershipDimension = 'regular_outlet' | string
export type StaffMembershipSource = 'baseline_manager_review' | 'transfer' | 'new_hire' | 'resignation' | 'correction' | 'system'
export type StaffMembershipReviewStatus = 'pending_review' | 'approved'
export interface StaffMembershipHistory { id: string; staffId: string; outletScopeId: string; membershipDimension: StaffMembershipDimension; effectiveFrom: string; effectiveTo?: string | null; source: StaffMembershipSource; reason: string; reviewStatus: StaffMembershipReviewStatus; reviewedAt?: string | null; reviewedBy?: string | null; baselineRevisionId?: string | null; isCurrentBaseline?: boolean; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface ResolvedStaffMembership { membershipId: string; staffId: string; staffName: string; staffNumber: string; designation: string; employmentStatus: string; outletScopeId: string; outletScopeKey: string; outletDisplayName: string; membershipStartWithinPeriod: string; membershipEndWithinPeriod: string; membershipDays: number; source: StaffMembershipSource; reviewStatus: StaffMembershipReviewStatus }
export type StaffMembershipScopeBlocker = 'STAFF_MEMBERSHIP_HISTORY_PRE_BASELINE' | 'STAFF_MEMBERSHIP_BASELINE_NOT_APPROVED' | 'OUTLET_SCOPE_NOT_FOUND'
export interface StaffMembershipScopeResolution { outlet: OutletScope | null; startDate: string; endDate: string; members: ResolvedStaffMembership[]; blocker: StaffMembershipScopeBlocker | null }
export type StaffMembershipBaselineStatus = 'not_started' | 'in_review' | 'correction_in_review' | 'approved' | 'superseded'
export interface StaffMembershipBaselineCandidate { staffId: string; name: string; employeeNumber: string; designation: string; department: string; currentOutlet: string; employmentStatus: string; joiningDate: string; resignationDate: string | null; suggestedInclude: boolean; selectedInclude: boolean; proposedEffectiveFrom: string; proposedEffectiveTo: string | null; warnings: string[] }
export interface StaffMembershipBaselineSelection { staffId: string; included: boolean; effectiveFrom: string; effectiveTo: string | null; reviewNote?: string }
export interface StaffMembershipBaselineReview { id: string; outletScopeId: string; outletScopeKey: string; month: string; status: Exclude<StaffMembershipBaselineStatus, 'not_started'>; revisionNumber: number; approvedMemberCount?: number; previousRevisionId?: string | null; reviewType: 'initial' | 'correction'; isCurrentRevision: boolean; isAuthoritative: boolean; approvedAt?: string | null; approvedBy?: string | null; approvedByUserId?: string | null; reopenedAt?: string | null; reopenedByUserId?: string | null; reopenedByName?: string | null; reopenReason?: string | null; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export type StaffMembershipBaselineChangeKind = 'added' | 'removed' | 'date_changed' | 'inclusion_changed' | 'unchanged'
export interface StaffMembershipBaselineChange { staffId: string; staffName: string; employeeNumber: string; kind: StaffMembershipBaselineChangeKind; before: StaffMembershipBaselineSelection | null; after: StaffMembershipBaselineSelection | null }
export interface StaffMembershipBaselineDiff { previousRevisionId: string; currentRevisionId: string; summary: { added: number; removed: number; dateChanges: number; unchanged: number }; changes: StaffMembershipBaselineChange[] }
export interface StaffMembershipBaselineStatusRead { reviewId: string | null; outletScopeKey: string; month: string; status: StaffMembershipBaselineStatus; revisionNumber: number | null; approvedMemberCount: number; approvedAt: string | null; approvedBy: string | null; blockers: string[]; warnings: string[]; approvedMemberships: StaffMembershipHistory[] }
export interface StaffMembershipBaselinePreview { outlet: OutletScope; month: string; status: StaffMembershipBaselineStatusRead; currentRevision?: StaffMembershipBaselineReview | null; authoritativeRevision?: StaffMembershipBaselineReview | null; revisionHistory: StaffMembershipBaselineReview[]; changes?: StaffMembershipBaselineDiff | null; suggestedCandidates: StaffMembershipBaselineCandidate[]; availableForManualInclusion: StaffMembershipBaselineCandidate[] }
export interface StaffMembershipBaselineApprovalResult { status: 'BASELINE_APPROVED' | 'BASELINE_ALREADY_APPROVED'; review: StaffMembershipBaselineReview; membershipIds: string[] }
export interface StaffEntitlement { staffId: string; staffNumber: string; staffName: string; employmentStatus: string; annualLeavePerYear: number; weeklyOffEntitlement: number; publicHolidayPerYear: number; persisted: boolean; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface StaffEntitlementBalance { staffId: string; year: number; annualLeave: { entitlement: number; used: number; remaining: number }; publicHoliday: { entitlement: number; used: number; remaining: number }; weeklyOff: { weekStart: string; weekEnd: string; required: number; assigned: number; difference: number; status: 'short' | 'compliant' | 'additional' } }
export interface PublicHoliday { id: string; name: string; date: string; days: number; active: boolean; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface RosterEntry { staffId: string; date: string; dutyCode: string; updatedAt: string; updatedBy: string }
export type LeaveClassification = 'annualLeave' | 'off' | 'publicHoliday' | 'sickLeave'
export interface StaffLeaveDay { staffId: string; staffName: string; staffNumber: string; employmentStatus: string; date: string; dutyCode: string; dutyLabel: string; classification: LeaveClassification }
export interface StaffLeaveRecord { id: string; staffId: string; staffName: string; staffNumber: string; employmentStatus: string; leaveType: LeaveClassification; fromDate: string; toDate: string; leaveDays: number; holidays: number; offDays: number; totalDays: number; entries: StaffLeaveDay[] }
export interface LeavePlannerDay extends StaffLeaveDay { color: string; dutyCodeValue: string; dutyCodeActive: boolean }
export interface LeavePlannerPeriod extends StaffLeaveRecord { designation: string; confirmationSource: 'Duty Roster'; entitlementDays: number; sourceDutyCode: string; color: string }
export interface LeavePlannerStaffRow {
  staffId: string; staffName: string; staffNumber: string; designation: string; employmentStatus: string
  membershipId: string; membershipStart: string; membershipEnd: string; membershipReviewStatus: StaffMembershipReviewStatus
  days: LeavePlannerDay[]; periods: LeavePlannerPeriod[]
  entitlement: StaffEntitlementBalance & { persisted: boolean; offAssignedInMonth: number }
}
export interface LeavePlannerDailyAvailability { date: string; members: number; scheduledWorking: number; unavailable: number; unassigned: number }
export interface LeavePlannerReadModel {
  outlet: OutletScope; month: string; startDate: string; endDate: string; membershipBlocker: StaffMembershipScopeBlocker | null
  rows: LeavePlannerStaffRow[]; availability: LeavePlannerDailyAvailability[]; dutyCodes: ConfigOption[]
}
export interface AttendanceRecord { staffId: string; date: string; scheduledDuty: string | null; actualDuty: string | null; attendanceStatus: string | null; notes: string | null; staff: Pick<Staff, 'id' | 'name' | 'number' | 'position' | 'employmentStatus'>; updatedAt?: string }
export interface TrainingAttendee { staffId: string; attendanceStatus: string | null; staff: Pick<Staff, 'name' | 'number' | 'position' | 'employmentStatus'> }
export type TrainingOperationalStatus = 'scheduled' | 'awaiting_confirmation' | 'completed' | 'cancelled'
export type TrainingEligibilityState = 'eligible' | 'excluded_off' | 'excluded_annual_leave' | 'requires_review'
export type TrainingParticipationState = 'participated' | 'did_not_participate' | 'not_applicable' | 'requires_review'
export interface TrainingSession { id: string; title: string; category: string; date: string; time: string; startTime?: string; endTime?: string; trainer: string; location?: string; status: string; operationalStatus?: TrainingOperationalStatus; notes: string; description?: string; active: boolean; attendees: TrainingAttendee[]; source?: 'manual' | 'hr_calendar' | 'sharepoint'; sourceFileName?: string | null; importBatchId?: string | null; importedAt?: string | null; sourceData?: Record<string, unknown> | null; managerCorrected?: boolean; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface TrainingStaffEvidence {
  staffId: string; staffName: string; staffNumber: string; designation: string
  membershipHistoryId: string | null; rosterEntryId: string | null; dutyCode: string | null; dutyLabel: string | null
  eligibilityState: TrainingEligibilityState; recommendedEligibility: TrainingEligibilityState
  participationState: TrainingParticipationState; creditedMinutes: number; evidenceNote: string
}
export interface TrainingCompletionEvidence {
  id: string; revisionNumber: number; outcome: 'awaiting_confirmation' | 'completed' | 'cancelled' | 'requires_review'
  actualDurationMinutes: number | null; creditedMinutesPerParticipant: number
  confirmedBy: string; confirmedAt: string; calculationPolicyVersion: string
  eligibleStaff: number; participantCount: number; creditedMinutes: number; requiresReviewCount: number
}
export interface TrainingSessionDetail {
  session: TrainingSession; sourceLabel: 'Manual' | 'HR File Import' | 'Future SharePoint Sync'
  operationalStatus: TrainingOperationalStatus; completion: TrainingCompletionEvidence | null
  staff: TrainingStaffEvidence[]; coveragePercent: number | null; sessionTrainingHours: number
}
export interface TrainingStaffCoverage {
  staffId: string; staffName: string; staffNumber: string; designation: string
  sessionsAttended: number; creditedMinutes: number; creditedHours: number; targetMinutes: number; remainingMinutes: number; minimumAchieved: boolean
}
export interface TrainingPerformance {
  month: string; target: { monthlyMinutes: number; monthlyHours: number; perHeadMinutes: number; perHeadHours: number; creditCapMinutes: number }
  sessionsScheduled: number; sessionsCompleted: number; creditedMinutes: number; trainingHours: number
  eligibleHeadcount: number; hoursPerHead: number; staffCovered: number; remainingMinutes: number; remainingHours: number
  targetAchieved: boolean; requiresReview: number; staffCoverage: TrainingStaffCoverage[]
}
export interface TrainingDefaults {
  durationMinutes: number; trainerMode: 'venue_manager' | 'staff'; trainerStaffId: string | null
  location: string; categoryValue: string | null; participantSelection: 'eligible_staff'
}
export interface TrainingTargetVersion {
  id: string; versionNumber: number; effectiveMonth: string
  monthlyTargetMinutes: number; monthlyTargetHours: number
  perHeadTargetMinutes: number; perHeadTargetHours: number
  participantCreditCapMinutes: number; calculationPolicyVersion: string
  approvedBy: string; approvedAt: string
}
export interface TrainingWorkflowOption {
  state: TrainingOperationalStatus; label: string; color: string; protected: true
}
export interface TrainingCustomization {
  defaults: TrainingDefaults; target: TrainingTargetVersion; workflow: TrainingWorkflowOption[]
}
export interface TrainingCompletionInput {
  actualDurationMinutes: number
  staff: Array<{ staffId: string; eligibilityState: TrainingEligibilityState; participationState: TrainingParticipationState; evidenceNote?: string }>
}
export interface StaffTrainingHistory { trainingId: string; title: string; date: string; category: string; attendanceStatus: string | null; status: string; active: boolean }
export type TrainingImportReadiness = 'READY' | 'REVIEW_REQUIRED' | 'DUPLICATE'
export interface TrainingImportRecord { topic: string; date: string; day: string; startTime: string; endTime: string; trainer: string; location: string; originalValues: Record<string, string>; warnings: string[]; readiness: TrainingImportReadiness; duplicateTrainingId?: string; duplicateWithinFile?: boolean }
export interface TrainingImportBatchSession { id: string; title: string; date: string; startTime: string; endTime: string; trainer: string; managerCorrected: boolean; originalValues?: Record<string, unknown> | null; active: boolean }
export interface TrainingImportBatch { id: string; fileName: string; fileHash: string; fileType: string; importedAt: string; createdBy?: string | null; active: boolean; removedAt?: string | null; removedBy?: string | null; removalAction?: 'removed' | 'replaced' | null; replacementBatchId?: string | null; sessionCount: number; sessions: TrainingImportBatchSession[] }
export interface TrainingImportPreview { batchId: string; fileName: string; fileHash: string; fileType: string; duplicateFile: boolean; summary: { detected: number; ready: number; requiresReview: number; duplicates: number }; replacementSummary: { ready: number; requiresReview: number; duplicatesWithinFile: number }; existingImport?: TrainingImportBatch; records: TrainingImportRecord[] }
export type TrainingImportReviewAction = 'IMPORT_ANYWAY' | 'EDIT_BEFORE_IMPORT' | 'SKIP'
export interface TrainingImportDecision { index: number; action: TrainingImportReviewAction; changes?: Pick<TrainingImportRecord, 'topic' | 'date' | 'startTime' | 'endTime' | 'trainer' | 'location'> }
export interface TrainingImportResult { imported: number; skipped: number; duplicates: number; failed?: number; importedIds: string[]; previousImportRemoved?: number; removed?: number }
export interface BookingRecord { id: string; guestName: string; roomNumber: string; birthDate: string | null; arrivalDate: string | null; departureDate: string | null; mealPeriod: string; reservationDate: string; reservationTime: string; bookingNumber: string; covers: number; bookingStatus: string; bookingSource: string; bookedBy: string; guestNotes: string; tableNumber: string; waiterId: string | null; waiter: Pick<Staff, 'name' | 'number' | 'position' | 'employmentStatus'> | null; importedBatchId?: string | null; importSource?: string | null; sourceActivityLabel?: string | null; sourceBookingStatus?: string | null; sourceFilename?: string | null; sourceReportDate?: string | null; sourceParserVersion?: string | null; sourceGuestNotes?: string | null; coverResolution?: BookingCoverResolution; memberSearchText?: string; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export type WalkInBookingInput = Pick<BookingRecord, 'id' | 'guestName' | 'roomNumber' | 'birthDate' | 'arrivalDate' | 'departureDate' | 'mealPeriod' | 'reservationDate' | 'reservationTime' | 'covers' | 'guestNotes' | 'tableNumber' | 'waiterId'>
export interface BookingSummary { totalBookings: number; expectedCovers: number; arrived: number; arrivedCovers: number; remainingBookings: number; remainingCovers: number; noShows: number; noShowCovers: number; unassignedTables: number; unassignedWaiters: number }
export interface ChargeableRecord { id: string; date: string; bookingId: string | null; guestName: string; roomNumber: string; checkInvoiceNumber?: string; tableNumber: string; itemValue: string; itemLabel: string; itemCategory: string; quantity: number; unitPrice: number; totalAmount: number; waiterId: string | null; waiter: Pick<Staff, 'name' | 'number' | 'position' | 'employmentStatus'> | null; status: string; notes: string; active: boolean; bookingNumber?: string | null; covers?: number; reservationDate?: string; reservationTime?: string; bookingSource?: string | null; importSource?: string | null; sourceGuestNotes?: string | null; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface ChargeableSummary { totalCharges: number; totalValue: number; realizedRevenue: number; pendingValue: number; charged: number; pending: number; itemsSold?: number; topSeller?: string; guests?: number }
export type ChargeableWriteRequest = ChargeableRecord & { correctionReason?: string }
export interface ChargeableDuplicateWarning { id: string; date: string; checkInvoiceNumber: string; roomNumber: string; tableNumber: string; itemLabel: string; quantity: number; waiterId: string | null }
export type WineSpiritSaleStatus = 'pending' | 'charged' | 'cancelled' | 'void'
export interface WineSpiritCalculation {
  grossUnitPrice: string; grossTotal: string; netUnitPrice: string; netTotal: string
  serviceChargeRate: string; gstRate: string; financialRateVersion: number
  appliedTier: string; tierMinimum: string; tierMaximum: string | null
  incentivePerBottle: string; totalIncentive: string; incentiveRuleVersion: number
}
export interface WineSpiritSale extends WineSpiritCalculation {
  id: string; outletScopeId: string; serviceDate: string; checkInvoiceNumber: string
  itemName: string; roomNumber: string; tableNumber: string; waiterId: string
  waiter: Pick<Staff, 'name' | 'number' | 'position' | 'employmentStatus'>
  quantity: number; status: WineSpiritSaleStatus; notes: string; archived: boolean
  duplicateWarnings?: Array<{ id: string; checkInvoiceNumber: string; itemName: string }>
  createdAt: string; updatedAt: string; createdBy: string; updatedBy: string
  archivedAt?: string | null; archivedBy?: string | null
}
export interface WineSpiritSaleInput {
  id: string; serviceDate: string; checkInvoiceNumber: string; itemName: string
  roomNumber: string; tableNumber: string; waiterId: string; grossUnitPrice: string
  quantity: number; status: WineSpiritSaleStatus; notes: string
}
export type WineSpiritSaleWriteRequest = WineSpiritSaleInput & { correctionReason?: string }
export type BillTipDistributionStatus = 'draft' | 'correction_in_review' | 'finalized' | 'superseded'
export interface BillTipDistribution { id: string; distributionMonth: string; poolAmount: string; status: BillTipDistributionStatus; externalAllocationTotal: string; remainingTeamPool: string; totalEligibleDays: number; eligibleStaffCount: number; valuePerEligibleDay: string; undistributedRemainder: string; policyVersion: string; policyMetadata: Record<string, unknown>; calculatedAt?: string | null; calculatedBy?: string | null; finalizedAt?: string | null; finalizedBy?: string | null; reopenedAt?: string | null; reopenedBy?: string | null; reopenReason?: string | null; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface BillTipStaffAllocation { id: string; distributionId: string; staffId: string; staffNameSnapshot: string; staffNumberSnapshot: string; designationSnapshot: string; eligibleDays: number; excludedAlDays: number; missingRosterDays: number; requiresRosterReview: boolean; valuePerEligibleDay: string; calculatedAmount: string; finalAmount: string; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface BillTipManualAllocation { id: string; distributionId: string; linkedStaffId: string | null; helperName: string; staffReference?: string; department?: string; outlet?: string; fixedAmount: string; reason: string; notes: string; idempotencyKey?: string | null; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export type IncentiveRuleFamily = 'no_incentive' | 'food_percentage' | 'wine_spirits_tier'
export type IncentiveRewardMode = 'none' | 'fixed' | 'percentage'
export interface IncentiveRuleTier { id?: string; minimumAmount: string; maximumAmount: string | null; rewardMode: IncentiveRewardMode; rewardValue: string }
export interface IncentiveRule { id: string; ruleKey: string; configurationOptionId?: string | null; sourceKey: string; ruleFamily: IncentiveRuleFamily; version: number; effectiveFrom: string; effectiveTo?: string | null; ratePercent?: string | null; active: boolean; tiers: IncentiveRuleTier[]; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface FinancialRateVersion { id: string; version: number; effectiveFrom: string; effectiveTo?: string | null; serviceChargeRate: string; gstRate: string; active: boolean; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export type ChargeableIncentiveEarningStatus = 'draft' | 'finalized' | 'reversed'
export interface ChargeableIncentiveEarning { id: string; sourceChargeableItemId: string; sellerId: string; sellerNameSnapshot: string; sellerNumberSnapshot: string; designationSnapshot: string; serviceDate: string; packageIdentity: string; quantity: number; guestAmount: string; eligibleNetAmount: string; financialRateVersionId?: string | null; financialRateVersion?: number | null; serviceChargeRate?: string | null; gstRate?: string | null; incentiveRuleId: string; incentiveRuleVersion: number; ruleFamilySnapshot: IncentiveRuleFamily; appliedRatePercent?: string | null; appliedFixedAmount?: string | null; appliedTierMinimum?: string | null; appliedTierMaximum?: string | null; calculatedAmount: string; finalAmount: string; status: ChargeableIncentiveEarningStatus; generationKey: string; reversalOfId?: string | null; finalizedAt?: string | null; finalizedBy?: string | null; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface BillTipRosterDiagnostic { staffId: string; staffName: string; staffNumber: string; designation: string; expectedDays: number; rosterDaysFound: number; eligibleDays: number; excludedAlDays: number; missingRosterDays: number; reviewRequired: boolean }
export interface BillTipDraftCalculation { distribution: BillTipDistribution; staff: BillTipRosterDiagnostic[]; blockers: string[] }
export interface IncentiveCalculation { grossTotal: string; eligibleNetTotal: string; appliedRatePercent: string | null; appliedFixedAmount: string | null; appliedTierMinimum: string | null; appliedTierMaximum: string | null; calculatedAmount: string; finalAmount: string }
export interface FinancialPreviewExternalAllocation { id: string; name: string; staffReference?: string; departmentOutlet?: string; fixedAmount: string; remarks?: string }
export interface FinancialPreviewStaff { staffId: string; staffName: string; staffNumber: string; designation: string; membershipFrom: string; membershipTo: string | null; eligibleRecordedDays: number; alDaysExcluded: number; otherExcludedDays: number; historicalMissingRosterDays: number; futureUnclosedDays: number; calculatedBillTip: string; reviewStatus: 'READY' | 'REVIEW_REQUIRED' }
export interface FinancialIncentivePreviewRecord {
  sourceType: 'FOOD' | 'WINE_SPIRITS'; sourceId: string; chargeableId?: string
  serviceDate: string; checkInvoiceNumber?: string; roomNumber?: string
  itemValue: string; itemLabel: string; quantity: number; grossAmount: string
  grossUnitPrice?: string; eligibleNetAmount: string; eligibleNetUnitPrice?: string
  appliedRule: string; appliedTier?: string; incentive: string
  soldByStaffId: string | null; soldByName: string | null; soldByNumber: string | null
  status: 'PROVISIONAL'; reviewStatus: 'READY' | 'REVIEW_REQUIRED'
  financialRateVersion: number; incentiveRuleVersion: number
}
export interface FinancialManagerPreview {
  generatedAt: string; month: string; outlet: { id: string; key: string; name: string }
  periodStatus: 'IN_PROGRESS' | 'CLOSED'; previewStatus: 'PROVISIONAL'; asOfDate: string
  membership: { revisionId: string; revisionNumber: number; status: 'APPROVED'; approvedAt: string; approvedBy: string; memberCount: number }
  billTips: { totalPool: string; externalAllocations: FinancialPreviewExternalAllocation[]; externalAllocationTotal: string; remainingRegularTeamPool: string; totalEligibleRecordedDays: number; valuePerEligibleDay: string; regularStaffDistributed: string; roundingRemainder: string; reviewStatus: 'READY' | 'REVIEW_REQUIRED'; staff: FinancialPreviewStaff[] }
  incentives: { realizedRecordCount: number; realizedGrossAmount: string; pendingExcludedCount: number; pendingExcludedAmount: string; unattributedRealizedCount: number; unattributedIncentiveAmount: string; reviewStatus: 'READY' | 'REVIEW_REQUIRED'; records: FinancialIncentivePreviewRecord[]; staffSummary: Array<{ staffId: string; staffName: string; staffNumber: string; foodIncentive: string; wineSpiritsIncentive: string; totalIncentive: string; wineSpiritsStatus: 'ACTIVE' }>; wineSpiritsLiveSource: 'ACTIVE' }
  earnings: Array<{ staffId: string; staffName: string; staffNumber: string; billTips: string; foodIncentives: string; wineSpiritsIncentives: string; totalExtraEarnings: string; status: 'READY' | 'REVIEW_REQUIRED' }>
}
export interface BillTipVersionStaffSnapshot { staffId: string; staffName: string; staffNumber: string; designation: string; membershipFrom: string | null; membershipTo: string | null; eligibleDays: number; alExcluded: number; otherExcluded: number; historicalMissing: number; valuePerDay: string; finalAmount: string }
export interface BillTipVersionExternalSnapshot { id: string; name: string; staffReference: string | null; departmentOutlet: string | null; fixedAmount: string; remarks: string }
export interface BillTipVersionSnapshot { id: string; outletScopeId: string; month: string; version: number; status: BillTipDistributionStatus; isCurrent: boolean; previousVersionId: string | null; correctionReason: string | null; membershipRevisionId: string; membershipRevisionNumber: number | null; pool: string; external: string; regularPool: string; eligibleDays: number; staffCount: number; valuePerDay: string; distributed: string; remainder: string; reconciliation: string; finalizedAt: string | null; finalizedByUserId: string | null; finalizedByName: string | null; reopenedAt: string | null; reopenedByName: string | null; createdAt: string; createdBy: string; staff: BillTipVersionStaffSnapshot[]; externalAllocations: BillTipVersionExternalSnapshot[] }
export interface BillTipVersionDiff { previousVersion: number; correctionVersion: number; totalPool: { before: string; after: string }; external: { before: string; after: string }; eligibleDays: { before: number; after: number }; valuePerDay: { before: string; after: string }; rounding: { before: string; after: string }; membershipRevision: { before: string; after: string }; staff: Array<{ staffId: string; staffName: string; staffNumber: string; change: 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED'; before: string | null; after: string | null }> }
export interface BillTipWorkflowState { month: string; outlet: { id: string; key: string; name: string }; database: { status: string; recoveryRequired: boolean; schemaVersion: string }; backup: { ready: boolean; backupId: string | null; createdAt: string | null; blockers: string[] }; history: BillTipVersionSnapshot[]; activeCorrection: BillTipVersionSnapshot | null; currentFinalized: BillTipVersionSnapshot | null }
export interface GuestOccasionRecord { id: string; occasionType: string; bookingId: string | null; guestName: string; roomNumber: string; reservationDate: string; reservationTime: string; tableNumber: string; waiterId: string | null; waiter: Pick<Staff, 'name' | 'number' | 'position' | 'employmentStatus'> | null; status: string; source: string; sourceText: string; notes: string; active: boolean; bookingNumber?: string | null; covers?: number; bookingSource?: string | null; importSource?: string | null; sourceFilename?: string | null; visitNumber?: number | null; previousAndaluciaVisits?: number; knownVisits?: number | null; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface GuestOccasionSummary { totalOccasions: number; attentionRequired: number; vipSpecialGuests: number; completed: number }
export type MaintenancePriority = 'normal' | 'urgent' | string
export interface MaintenanceRecord { id: string; issue: string; dateReported: string; area: string; priority?: MaintenancePriority; status: string; referenceFollowUp?: string; notes: string; reportedByStaffId: string | null; reportedBy: Pick<Staff, 'name' | 'number' | 'position' | 'employmentStatus'> | null; reporterNameSnapshot?: string | null; reporterNumberSnapshot?: string | null; completedAt?: string | null; completedByUserId?: string | null; completedByNameSnapshot?: string | null; outletScopeId?: string | null; revision?: number; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface MaintenanceSummary { openIssues: number; inProgress: number; completedToday: number; unresolved?: number; urgentUnresolved?: number; normalUnresolved?: number }
export interface MaintenanceDuplicateWarning { id: string; issue: string; area: string; status: string; dateReported: string; reporter: string; sameReporter: boolean; daysApart: number }
export type ReportPeriodType = 'today' | 'week' | 'month' | 'custom'
export interface ReportBreakdown { key: string; label: string; count: number }
export interface ReportManagerSummary { id?: string; periodType: ReportPeriodType; startDate: string; endDate: string; managerNotes: string; createdAt?: string; updatedAt?: string; createdBy?: string; updatedBy?: string }
export interface OperationalReport {
  period: { type: ReportPeriodType; startDate: string; endDate: string; previousStartDate: string | null; previousEndDate: string | null; dayCount: number }
  executive: { totalBookings: number; expectedCovers: number; arrivedCovers: number; noShows: number; guestOccasions: number; chargeableRevenue: number; attendanceExceptions: number; openMaintenanceIssues: number }
  bookings: { totalBookings: number; expectedCovers: number; totalCovers: number; adults: number; kids: number; totalAdults: number; totalKids: number; arrivedBookings: number; arrivedCovers: number; arrivalPercent: number; remainingBookings: number; remainingCovers: number; noShows: number; noShowCovers: number; noShowRate: number; averageCoversPerBooking: number; busiestDate: string | null; averageCoversPerDay: number; byTime: Array<{ time: string; bookings: number; expectedCovers: number; totalCovers: number; adults: number; kids: number; totalAdults: number; totalKids: number; arrivedCovers: number; arrivalPercent: number; status: string; remainingBookings: number; remainingCovers: number; noShows: number; noShowCovers: number }>; byDate: Array<{ date: string; bookings: number; expectedCovers: number; totalCovers: number; adults: number; kids: number; totalAdults: number; totalKids: number; arrivedCovers: number; arrivalPercent: number; remainingBookings: number; remainingCovers: number; noShows: number; noShowCovers: number }>; byWeek: Array<{ weekStart: string; weekEnd: string; label: string; bookings: number; expectedCovers: number; totalCovers: number; adults: number; kids: number; totalAdults: number; totalKids: number; arrivedCovers: number; arrivalPercent: number; remainingBookings: number; remainingCovers: number; noShows: number; noShowCovers: number }> }
  attendance: { scheduledStaff: number; actualWorking: number; off: number; annualLeave: number; exceptions: number; details: Array<{ date: string; staffId: string; staffName: string; staffNumber: string; employmentStatus: string; scheduledDuty: string | null; actualDuty: string | null; attendanceStatus: string | null; isException: boolean }> }
  training: { sessions: number; participants: number; attended: number; absent: number; excused: number; sessionDetails: Array<{ id: string; date: string; title: string; category: string; status: string; participants: number; attended: number; absent: number; excused: number }>; employeeParticipation: Array<{ staffId: string; staffName: string; staffNumber: string; employmentStatus: string; sessions: number; attended: number }> }
  occasions: { total: number; completed: number; pendingActive: number; requiringAttention: number; byType: ReportBreakdown[]; byCategory: ReportBreakdown[]; byStatus: ReportBreakdown[]; byDate: Array<{ date: string; total: number; byCategory: ReportBreakdown[] }>; byWeek: Array<{ weekStart: string; weekEnd: string; label: string; total: number; byCategory: ReportBreakdown[] }>; records: Array<{ id: string; bookingId: string | null; date: string; guestName: string; roomNumber: string; covers: number; occasionType: string; category: string; status: string }> }
  chargeables: { totalRevenue: number; realizedRevenue: number; pendingValue: number; pendingItems: number; itemsSold: number; topSeller: string; topSellerRevenue: number; mostSoldItem: string; topItem: { item: string; quantity: number; revenue: number } | null; topWaiter: { waiterId: string | null; waiter: string; staffNumber: string; employmentStatus: string; itemsSold: number; revenue: number; revenuePercent: number } | null; financialProofRecords: Array<{ id: string; date: string; guestName: string; roomNumber: string; checkInvoiceNumber: string; item: string; quantity: number; grossTotal: number; status: string; waiter: string }>; byItem: Array<{ itemValue: string; item: string; quantity: number; revenue: number }>; byWaiter: Array<{ rank: number; waiterId: string | null; waiter: string; staffNumber: string; employmentStatus: string; itemsSold: number; revenue: number; revenuePercent: number; items: Array<{ item: string; quantity: number; revenue: number }> }>; byDate: Array<{ date: string; realizedRevenue: number; itemsSold: number }>; byWeek: Array<{ weekStart: string; weekEnd: string; label: string; realizedRevenue: number; itemsSold: number }> }
  maintenance: { issuesReported: number; open: number; inProgress: number; completed: number; completedDuringPeriod: number; completedToday: number; unresolved: number; urgentUnresolved: number; normalUnresolved: number; byArea: ReportBreakdown[]; byDate: Array<{ date: string; issuesReported: number; completed: number }>; byWeek: Array<{ weekStart: string; weekEnd: string; label: string; issuesReported: number; completed: number }>; records: Array<{ id: string; date: string; completionDate: string | null; issue: string; area: string; status: string; priority: string; referenceFollowUp: string }> }
  comparison: Array<{ key: string; label: string; current: number; previous: number; changePercent: number | null; movement: 'up' | 'down' | 'flat'; favorableWhen: 'up' | 'down' | 'neutral' }>
  managerSummary: ReportManagerSummary | null
}
export type DailyReportStatus = 'draft' | 'reviewed' | 'approved' | 'superseded'
export type DailyReportReadinessState = 'complete' | 'warning' | 'missing'
export interface DailyReportVoidDetail { amount: string; reason: string; checkInvoiceNumber: string }
export interface DailyReportDoubleDineDetail { roomNumber: string; pax: number; sourceOutlet: string; note: string }
export interface DailyReportRevenueVerification { acknowledged: boolean; verifiedByUserId?: string; verifiedByName?: string; verifiedAt?: string; netSale?: string; totalRevenue?: string; difference?: string; messages?: string[] }
export interface DailyReportManualPayload {
  symphony: { foodRevenue: string; beverageRevenue: string; wineRevenue: string; liquorRevenue: string; totalSale: string; totalDiscount: string; totalVoid: string; netSale: string; totalRevenue: string; voidDetails: DailyReportVoidDetail[] }
  serviceVerification: { doubleDinePax: number | null; details: DailyReportDoubleDineDetail[] }
  manager: { operationSummary: string; keyOperationalIssue?: string; guestFeedbackServiceRecovery?: string; followUpRequired?: string }
  revenueVerification?: DailyReportRevenueVerification
  completion?: Record<string, DailyReportReadinessState>
}
export interface DailyReportRecord {
  id: string; outletScopeId: string; serviceDate: string; revisionNumber: number; status: DailyReportStatus; isCurrentAuthority: boolean; manualPayload: DailyReportManualPayload
  preparedByUserId: string; preparedByName: string; preparedAt: string; reviewedByUserId: string | null; reviewedByName: string | null; reviewedAt: string | null; approvedByUserId: string | null; approvedByName: string | null; approvedAt: string | null
}
export interface DailyReportSnapshot { id: string; dailyReportId: string; outletScopeId: string; serviceDate: string; revisionNumber: number; frozenPayload: DailyReportFrozenPayload; snapshotSha256: string; approvedByUserId: string; approvedByName: string; approvedAt: string; createdAt: string }
export interface DailyReportUpsellDetail { id: string; item: string; quantity: number; soldBy: string; staffNumber: string; roomNumber: string; checkInvoiceNumber: string; amount: string; source: 'Chargeable' | 'Wine / Spirits' }
export interface DailyReportOccasionRoom { occasionId: string; bookingId: string | null; category: string; label: string; guestName: string; roomNumber: string; covers: number }
export interface DailyReportFrozenPayload {
  servicePerformance: { totalCovers: number; adults: number; kids: number; totalBookings: number; arrivedCovers: number; noShowCovers: number; noShowRooms: string[]; walkIns: number; bookingByTimeSlot: Array<{ time: string; bookings: number; covers: number; adults: number; kids: number; noShows: number; status: string }> }
  symphony: DailyReportManualPayload['symphony']
  serviceVerification: { doubleDinePax: number; details: DailyReportDoubleDineDetail[] }
  upselling: { chargeables: DailyReportUpsellDetail[]; wineSpirits: DailyReportUpsellDetail[]; details: DailyReportUpsellDetail[]; totalUpsellRevenue: string; itemsSold: number; topItem: string; topSeller: string }
  guestOccasions: { categories: Array<{ key: string; label: string; count: number; covers: number }>; roomDetails: DailyReportOccasionRoom[] }
  manager: DailyReportManualPayload['manager']
  revenueVerification?: DailyReportRevenueVerification
  identity?: { outletScopeId: string; serviceDate: string; revisionNumber: number; status: 'approved'; preparedBy: { userId: string; name: string; at: string }; reviewedBy: { userId: string; name: string; at: string }; approvedBy: { userId: string; name: string; at: string } }
}
export interface DailyReportReadinessItem { key: string; label: string; state: DailyReportReadinessState; message: string; blocking: boolean; verificationRequired?: boolean }
export interface DailyReportView {
  outlet: { id: string; key: string; name: string }; serviceDate: string; report: DailyReportRecord | null; snapshot: DailyReportSnapshot | null; content: DailyReportFrozenPayload; readiness: DailyReportReadinessItem[]; editable: boolean
  revenueReconciliation: { status: 'incomplete' | 'reconciled' | 'verification-required' | 'verified-with-variance'; messages: string[]; netSale: string | null; totalRevenue: string | null; difference: string | null; verifiedByName?: string; verifiedAt?: string }
}
export type WeeklyReportDayStatus = 'approved' | 'draft' | 'reviewed' | 'missing-report' | 'in-progress' | 'not-yet-closed'
export interface WeeklyReportDay {
  date: string; status: WeeklyReportDayStatus; reportId: string | null
  covers: number | null; bookings: number | null; kids: number | null; arrivedCovers: number | null; noShowCovers: number | null; walkIns: number | null; doubleDinePax: number | null
}
export interface WeeklyReportTotals { totalCovers: number; totalBookings: number; totalKids: number; arrivedCovers: number; noShowCovers: number; walkIns: number; doubleDinePax: number; averageCoversPerServiceNight: number }
export interface WeeklyReportView {
  outlet: { id: string; key: string; name: string }; weekStart: string; weekEnd: string; today: string
  authority: { state: 'complete' | 'in-progress' | 'partial' | 'no-approved-data'; label: string; approvedDays: number; expectedDays: number; totalDays: 7 }
  days: WeeklyReportDay[]; totals: WeeklyReportTotals
  revenue: { foodRevenue: string; beverageRevenue: string; wineRevenue: string; liquorRevenue: string; totalSale: string; totalDiscount: string; totalVoid: string; netSale: string; totalRevenue: string }
  variances: Array<{ date: string; netSale: string; totalRevenue: string; difference: string; verifiedBy: string; verifiedAt: string }>
  upselling: { totalRevenue: string; itemsSold: number; chargeableRevenue: string; wineSpiritsRevenue: string; topItem: string; topSeller: string; topItems: Array<{ label: string; quantity: number; revenue: string }>; topSellers: Array<{ label: string; revenue: string }> }
  occasions: Array<{ key: string; label: string; count: number; covers: number }>
  attention: { noShowCovers: number; noShowRate: number | null; walkIns: number; doubleDinePax: number; highestNoShowDay: string | null; highestCoversDay: string | null; busiestServiceDay: string | null }
  comparison: { available: boolean; reason: string; previousWeekStart: string; previousWeekEnd: string; metrics: Array<{ key: string; label: string; current: number; previous: number; difference: number; changePercent: number | null }> }
  commentary: ReportManagerSummary | null
  status: Array<{ label: string; state: 'complete' | 'partial' | 'missing' | 'saved'; detail: string }>
}
export type MonthlyFinanceStatus = 'not_entered' | 'entered' | 'verified' | 'verified_with_variance'
export type MonthlyFinanceField = 'foodRequisitions'|'netFoodCost'|'foodSales'|'mtdFoodCostPercent'|'budgetFoodCostPercent'|'foodCostVariancePercent'|'foodCostPerCover'|'beverageRequisitions'|'netBeverageCost'|'beverageSales'|'mtdBeverageCostPercent'|'budgetBeverageCostPercent'|'beverageCostVariancePercent'|'beverageCostPerCover'|'storesRequisitionsFood'|'commissaryRequisitions'|'butchery'|'totalFoodRequisitions'|'storesRequisitionsBeverage'|'foodToBeverage'|'beverageToFood'|'transferIn'|'transferOut'|'breakages'|'foodWastage'|'beverageWastage'|'beverageSpoilage'|'enteredFoodCostPercent'|'calculatedFoodCostPercent'|'foodCostPercentDifference'|'enteredBeverageCostPercent'|'calculatedBeverageCostPercent'|'beverageCostPercentDifference'
export type MonthlyFinancePayload = Record<MonthlyFinanceField,string|null>
export interface MonthlyReportInput { id:string; outletScopeId:string; monthStart:string; revisionNumber:number; financeStatus:MonthlyFinanceStatus; financePayload:MonthlyFinancePayload; managerCommentary:string; followUpsChanges:string; verifiedByUserId:string|null; verifiedByName:string|null; verifiedAt:string|null; createdByUserId:string; createdByName:string; createdAt:string; updatedByUserId:string; updatedByName:string; updatedAt:string }
export interface MonthlyReportDay { date:string; status:WeeklyReportDayStatus; reportId:string|null; covers:number|null; bookings:number|null; kids:number|null; arrivedCovers:number|null; noShowCovers:number|null; walkIns:number|null; doubleDinePax:number|null }
export interface MonthlyReportView {
  outlet:{id:string;key:string;name:string}; monthStart:string; monthEnd:string; today:string
  authority:{state:'complete'|'in-progress'|'partial'|'no-approved-data';label:string;approvedDays:number;expectedDays:number;totalDays:number}
  days:MonthlyReportDay[]; totals:WeeklyReportTotals
  revenue:WeeklyReportView['revenue']; variances:WeeklyReportView['variances']; upselling:WeeklyReportView['upselling']; occasions:WeeklyReportView['occasions']
  attention:{noShowRate:number|null;highestCoversDay:string|null;lowestCoversDay:string|null;busiestServiceDay:string|null}
  staffing:{currentTeamSize:number;averageOnDuty:number;offDays:number;annualLeaveDays:number;publicHolidays:number;sickLeaveDays:number}
  training:{sessions:number;participants:number;attendance:number|null;hours:number|null}
  maintenance:{opened:number;completed:number;stillOpen:number;inProgress:number;unresolved:number;items:Array<{id:string;issue:string;status:string;area:string}>}
  finance:{input:MonthlyReportInput|null;complete:boolean;foodMatched:boolean|null;beverageMatched:boolean|null}
  comparison:{available:boolean;reason:string;previousMonthStart:string;previousMonthEnd:string;financeAvailable:boolean;metrics:Array<{key:string;label:string;current:number;previous:number;difference:number;changePercent:number|null}>}
  readiness:Array<{label:string;state:'complete'|'warning'|'missing'|'pending';detail:string}>
  overallStatus:'MONTH IN PROGRESS'|'OPERATIONS COMPLETE'|'FINANCE PENDING'|'MONTHLY REPORT READY'
  legacyCommentary:ReportManagerSummary|null
}
export type BookingImportReadiness = 'READY' | 'WARNING' | 'REVIEW_REQUIRED' | 'DUPLICATE'
export interface BookingGuestMemberPreview { guestName: string; roomNumber: string; accommodationCode: string; birthDate: string | null; arrivalDate: string | null; departureDate: string | null; mealPlan: string; guestNotes: string; sourceRowOrder: number }
export type BookingCoverResolutionSource = 'base_confirmed_pax' | 'base_pending_pax' | 'base_cancelled_pax' | 'explicit_booking_override' | 'group_total' | 'linked_room_group_total' | 'joining_family_total' | 'incremental_addition' | 'arithmetic_expression' | 'structured_member_count'
export interface BookingCoverResolution { baseCovers: number | null; totalCovers: number | null; adults: number | null; kids: number; structuredKids: number; explicitKids: number; source: BookingCoverResolutionSource; evidence: string; groupId?: string; groupTotal?: number; diagnostics: string[] }
export type BookingPaxSemantic = 'SOURCE_PAX' | 'GROUP_TOTAL' | 'INCREMENTAL_ADDITION' | 'STRUCTURED_MEMBER_COUNT' | 'BLOCKED_CAPACITY' | 'MANAGER_REVIEW'
export interface BookingCoverLedgerEntry { index: number; bookingNumber: string; reservationTime: string; rooms: string[]; sourcePax: number; structuredMemberCount: number; commentPaxEvidence: string; paxSemantic: BookingPaxSemantic; effectiveOperationalPax: number; delta: number; groupIdentity: string | null; bookingState: 'NEW' | 'EXISTING'; reason: string; reviewRequired: boolean }
export interface BookingCoverReconciliation { rawSectionHeaderTotal: number; sourceBookingTotal: number; positiveAdjustments: number; exclusions: number; effectiveOperationalTotal: number; arithmeticDifference: number; unresolvedRecords: number; reconciled: boolean; ledger: BookingCoverLedgerEntry[] }
export type BookingIntelligenceReviewState = 'NOT_REQUIRED' | 'REVIEW_REQUIRED'
export interface BookingIntelligenceFinding {
  sourceCandidateIdentity: string
  memberIdentity?: string
  findingType: string
  normalizedKey: string
  displayLabel: string
  rawEvidence: string
  detectedPhrase: string
  evidenceLocation: string
  evidenceSha256: string
  ruleKey: string
  ruleVersion: string
  sourceValue: unknown
  detectedValue: unknown
  effectiveCandidate: unknown
  resolutionMethod: string
  confidence: number
  reviewState: BookingIntelligenceReviewState
}
export interface BookingIntelligencePreview {
  rulesetVersion: string
  findings: BookingIntelligenceFinding[]
  sourcePax: number | null
  detectedPax: number | null
  effectiveCandidatePax: number | null
  showPaxComparison: boolean
  reviewRequired: boolean
  highPriorityReasons: string[]
  legacyOccasionKeys: string[]
  newOccasionKeys: string[]
  occasionDiscrepancies: string[]
  paxSemantic: BookingPaxSemantic
  operationalContributionPax: number
  coverDelta: number
  groupIdentity: string | null
  coverReason: string
}
export interface BookingImportPreviewRecord { venue: 'andalucia'; reservationDate: string; reservationTime: string; bookingNumber: string; primaryGuest: string; rooms: string[]; covers: number | null; sourceStatus: string; bookedBy: string; sourceNotes: string; activityLabel: string; walkIn: boolean; guestMembers: BookingGuestMemberPreview[]; warnings: string[]; readiness: BookingImportReadiness; coverResolution?: BookingCoverResolution; intelligence?: BookingIntelligencePreview; duplicateBookingId?: string }
export interface BookingImportPreview { batchId: string; fileName: string; fileHash: string; reportDate: string; parserVersion: string; duplicateFile: boolean; summary: { bookingGroups: number; totalCovers: number; confirmed: number; pending: number; warnings: number; possibleDuplicates: number }; validation: { declaredBookingGroups: number; declaredCovers: number; reconciled: boolean; messages: string[]; coverReconciliation?: BookingCoverReconciliation }; bookings: BookingImportPreviewRecord[] }
export interface BookingIntelligenceReanalysisRecord { index: number; source: BookingImportPreviewRecord; existing: BookingImportPreviewRecord; existingOccasionKeys?: string[]; occasionProjectionDifferences?: string[] }
export interface BookingIntelligenceReanalysisPreview { batchId: string; rulesetVersion: string; existingBookings: number; intelligenceFindings: number; requiresIntelligenceReview: number; records: BookingIntelligenceReanalysisRecord[] }
export interface GuestExperienceAttentionRecord { id: string; bookingId: string; findingType: 'guest_attention' | 'allergy'; normalizedKey: 'GUEST_ATTENTION_TLC' | 'ALLERGY'; label: string; guestName: string; roomNumber: string; reservationDate: string; reservationTime: string; tableNumber: string; waiterId: string | null; bookingNumber: string; covers: number; rawEvidence: string; detectedPhrase: string; evidenceLocation: string; ruleKey: string; ruleVersion: string; operationalStatus: 'attention'; source: 'booking_intelligence' }
export interface GuestExperienceView { occasions: GuestOccasionRecord[]; attention: GuestExperienceAttentionRecord[]; groups: { celebrations: number; vipSpecial: number; attentionNeeded: number; completed: number } }
export type BookingImportReviewAction = 'IMPORT_ANYWAY' | 'EDIT_BEFORE_IMPORT' | 'SKIP'
export interface BookingImportReviewChanges { reservationDate: string; reservationTime: string; primaryGuest: string; room: string; covers: number; sourceStatus: string; sourceNotes: string }
export interface BookingImportReviewDecision { index: number; action: BookingImportReviewAction; changes?: BookingImportReviewChanges }
export interface BookingImportReviewValidation { record: BookingImportPreviewRecord; duplicateBookingId?: string }
export interface BookingImportResult { batchId: string; reservationDate: string; importedBookings: number; importedCovers: number; managerApprovedReviewItems: number; skippedDuplicates: number; skippedReviewRecords: number; skippedByManager: number; warnings: number; failedRecords: Array<{ bookingNumber: string; reason: string }>; importedBookingIds: string[] }
export const config: Configuration = {
  dutyCodes: [
    { id: 'on', value: 'ON', label: 'Duty', color: '#1b6288', active: true, metadata: { countsAsWorking: true, dutyClassification: 'working' } },
    { id: 'off', value: 'OFF', label: 'Off', color: '#a7b0ba', active: true, metadata: { countsAsWorking: false, dutyClassification: 'off' } },
    { id: 'al', value: 'AL', label: 'Annual Leave', color: '#b38b3a', active: true, metadata: { countsAsWorking: false, dutyClassification: 'annualLeave' } }
  ],
  employmentStatuses: [
    { id: 'active', value: 'active', label: 'Active', color: '#1b6288', active: true, metadata: { eligibleForAssignments: true, employmentStage: 'active' } },
    { id: 'on-leave', value: 'on_leave', label: 'On Leave', color: '#b38b3a', active: true, metadata: { eligibleForAssignments: false, employmentStage: 'temporarilyUnavailable' } },
    { id: 'off-day', value: 'off_day', label: 'Off Day', color: '#78909c', active: true, metadata: { eligibleForAssignments: false, employmentStage: 'temporarilyUnavailable' } },
    { id: 'inactive', value: 'inactive', label: 'Inactive', color: '#7b8790', active: true, metadata: { eligibleForAssignments: false, employmentStage: 'inactive' } },
    { id: 'resigned', value: 'resigned', label: 'Resigned', color: '#8a6f6b', active: true, metadata: { eligibleForAssignments: false, employmentStage: 'inactive' } },
    { id: 'transferred', value: 'transferred', label: 'Transferred', color: '#6f7896', active: true, metadata: { eligibleForAssignments: false, employmentStage: 'inactive' } },
    { id: 'new-hire', value: 'new_hire', label: 'New Hire', color: '#2f8063', active: true, metadata: { eligibleForAssignments: true, employmentStage: 'active' } }
  ],
  attendanceStatuses: [
    { id: 'worked-as-scheduled', value: 'worked_as_scheduled', label: 'Worked as scheduled', color: '#1b6288', active: true, metadata: { description: 'Completed the scheduled duty.', countsAsException: false } },
    { id: 'different-duty', value: 'different_duty', label: 'Different duty', color: '#b38b3a', active: true, metadata: { description: 'Worked a duty different from the schedule.', countsAsException: true } },
    { id: 'absent', value: 'absent', label: 'Absent', color: '#b74b45', active: true, metadata: { description: 'Did not attend the assigned duty.', countsAsException: true } },
    { id: 'late', value: 'late', label: 'Late', color: '#b38b3a', active: true, metadata: { description: 'Attended late.', countsAsException: true } },
    { id: 'left-early', value: 'left_early', label: 'Left early', color: '#a86842', active: true, metadata: { description: 'Left before completing the duty.', countsAsException: true } }
  ],
  bookingStatuses: [{ id: 'booking-status-confirmed', value: 'confirmed', label: 'Confirmed', color: '#1b6288', active: true, metadata: { serviceStage: 'remaining' } }, { id: 'booking-status-waiting', value: 'waiting', label: 'Waiting', color: '#c18f32', active: true, metadata: { serviceStage: 'remaining', operationalAction: 'waiting' } }, { id: 'booking-status-arrived', value: 'arrived', label: 'Arrived', color: '#2f8063', active: true, metadata: { bookingMetric: 'arrived', serviceStage: 'arrived', operationalAction: 'arrived' } }, { id: 'booking-status-no-show', value: 'no_show', label: 'No-Show', color: '#b74b45', active: true, metadata: { bookingMetric: 'noShow', excludesFromExpectedCovers: true, serviceStage: 'noShow', operationalAction: 'noShow' } }, { id: 'booking-status-cancelled', value: 'cancelled', label: 'Cancelled', color: '#a7b0ba', active: true, metadata: { excludesFromExpectedCovers: true, serviceStage: 'excluded' } }, { id: 'booking-status-completed', value: 'completed', label: 'Completed', color: '#5d7180', active: true, metadata: { serviceStage: 'completed' } }],
  bookingSources: [...['Activity Program', 'Guest', 'Chat Agent', 'Reception', 'Manual', 'Other'].map(value => ({ id: `booking-source-${value.toLowerCase().replaceAll(' ', '-')}`, value: value.toLowerCase().replaceAll(' ', '_'), label: value, active: true })), { id: 'booking-source-walk-in', value: 'walk_in', label: 'Walk-In', active: true, metadata: { systemControlled: true, protected: true } }],
  restaurantTables: Array.from({ length: 12 }, (_, index) => ({ id: `restaurant-table-${index + 1}`, value: `T${String(index + 1).padStart(2, '0')}`, label: `Table ${index + 1}`, active: true })),
  restaurantTableRanges: [[10, 29], [30, 39], [40, 49], [60, 69], [70, 79]].map(([start, end]) => ({ id: `restaurant-table-range-${start}-${end}`, value: `${start}-${end}`, label: `${start}–${end}`, active: true, metadata: { tableRangeStart: start, tableRangeEnd: end } })),
  bookingWalkInFields: [
    ['guestName', 'Guest Name', 'optional'], ['roomNumber', 'Room Number', 'optional'], ['reservationDate', 'Reservation Date', 'required'], ['reservationTime', 'Reservation Time', 'required'], ['covers', 'Covers', 'required'], ['mealPeriod', 'Meal Period', 'required'], ['tableNumber', 'Table Number', 'optional'], ['waiterId', 'Waiter', 'optional'], ['bookingStatus', 'Booking Status', 'system'], ['bookingSource', 'Booking Source', 'system'], ['bookingNumber', 'Booking Number', 'hidden'], ['bookedBy', 'Booked By', 'system'], ['birthDate', 'Birth Date', 'hidden'], ['arrivalDate', 'Arrival Date', 'hidden'], ['departureDate', 'Departure Date', 'hidden'], ['guestNotes', 'Guest Notes', 'optional']
  ].map(([value, label, mode]) => ({ id: `walk-in-field-${value}`, value, label, active: true, metadata: { walkInFieldMode: mode as WalkInFieldMode, recommendedMode: mode as WalkInFieldMode, protected: ['reservationDate', 'reservationTime', 'covers', 'mealPeriod'].includes(value), systemControlled: mode === 'system' } })),
  positions: ['Venue Manager', 'Assistant Restaurant Manager', 'Restaurant Supervisor', 'F&B Attendant', 'Waiter', 'Host', 'Hostess'].map(value => ({ id: value, value, label: value, active: true, metadata: { serviceAssignmentEligible: ['Venue Manager', 'Assistant Restaurant Manager', 'Restaurant Supervisor', 'F&B Attendant', 'Waiter'].includes(value) } })),
  chargeableItems: [
    { id: 'chargeable-lobster-paella', value: 'lobster_paella', label: 'Lobster Paella', active: true, metadata: { category: 'Food', price: 85 } },
    { id: 'chargeable-birthday-basic', value: 'birthday_basic', label: 'Birthday Basic', active: true, metadata: { category: 'Celebration', price: 75 } },
    { id: 'chargeable-birthday-premium', value: 'birthday_premium', label: 'Birthday Premium', active: true, metadata: { category: 'Celebration', price: 135 } },
    { id: 'chargeable-anniversary-basic', value: 'anniversary_basic', label: 'Anniversary Basic', active: true, metadata: { category: 'Celebration', price: 75 } },
    { id: 'chargeable-anniversary-premium', value: 'anniversary_premium', label: 'Anniversary Premium', active: true, metadata: { category: 'Celebration', price: 135 } }
  ],
  chargeableStatuses: [{ id: 'chargeable-status-pending', value: 'pending', label: 'Pending', color: '#b38b3a', active: true, metadata: { chargeableStage: 'pending', countsAsRealizedRevenue: false, countsAsPendingValue: true, excludesFromChargeableTotals: false } }, { id: 'chargeable-status-charged', value: 'charged', label: 'Charged', color: '#2f8063', active: true, metadata: { chargeableStage: 'charged', countsAsRealizedRevenue: true, countsAsPendingValue: false, excludesFromChargeableTotals: false } }, { id: 'chargeable-status-cancelled', value: 'cancelled', label: 'Cancelled', color: '#a7b0ba', active: true, metadata: { chargeableStage: 'cancelled', countsAsRealizedRevenue: false, countsAsPendingValue: false, excludesFromChargeableTotals: true } }],
  wineSpiritCatalog: [],
  occasionTypes: [
    { id: 'occasion-honeymoon', value: 'honeymoon', label: 'Honeymoon', color: '#b36f8d', active: true, metadata: { detectionKeywords: ['honeymoon', 'honeymooners'], defaultStatus: 'pending', occasionCategory: 'honeymoon' } },
    { id: 'occasion-birthday', value: 'birthday', label: 'Birthday', color: '#b38b3a', active: true, metadata: { detectionKeywords: ['birthday', 'birthday celebration'], defaultStatus: 'pending', occasionCategory: 'birthday' } },
    { id: 'occasion-anniversary', value: 'anniversary', label: 'Anniversary', color: '#7d6399', active: true, metadata: { detectionKeywords: ['anniversary', 'wedding anniversary'], defaultStatus: 'pending', occasionCategory: 'anniversary' } },
    { id: 'occasion-see-you-soon', value: 'see_you_soon', label: 'See You Soon', color: '#4d7fa0', active: true, metadata: { detectionKeywords: ['see you soon'], defaultStatus: 'pending', occasionCategory: 'seeYouSoon' } },
    { id: 'occasion-siyam-family', value: 'siyam_family', label: 'Siyam Family', color: '#2e6f68', active: true, metadata: { detectionKeywords: ['siyam world family members'], defaultStatus: 'pending', occasionCategory: 'siyamFamily', countsAsVipSpecial: true } },
    { id: 'occasion-famtrip', value: 'famtrip', label: 'Famtrip', color: '#6c63a8', active: true, metadata: { detectionKeywords: ['famtrip', 'fam trip'], defaultStatus: 'pending', occasionCategory: 'famtrip', countsAsVipSpecial: true } },
    { id: 'occasion-presstrip', value: 'presstrip', label: 'Presstrip', color: '#9b5f53', active: true, metadata: { detectionKeywords: ['presstrip', 'press trip'], defaultStatus: 'pending', occasionCategory: 'presstrip', countsAsVipSpecial: true } }
  ],
  occasionStatuses: [{ id: 'occasion-status-pending', value: 'pending', label: 'Attention', color: '#b38b3a', active: true, metadata: { countsAsOccasionAttention: true, occasionStage: 'active', occasionWorkflow: 'attention' } }, { id: 'occasion-status-ready', value: 'ready', label: 'Prepared', color: '#2f8063', active: true, metadata: { countsAsOccasionAttention: false, occasionStage: 'active', occasionWorkflow: 'prepared' } }, { id: 'occasion-status-completed', value: 'completed', label: 'Completed', color: '#647680', active: true, metadata: { countsAsOccasionAttention: false, occasionStage: 'completed', occasionWorkflow: 'completed' } }],
  maintenanceAreas: ['Dining Area', 'Kitchen', 'Bar', 'Hostess Desk', 'Store', 'Back of House', 'Terrace', 'Other'].map(label => ({ id: `maintenance-area-${label.toLowerCase().replaceAll(' ', '-')}`, value: label.toLowerCase().replaceAll(' ', '_'), label, active: true })),
  maintenanceStatuses: [{ id: 'maintenance-status-open', value: 'open', label: 'Open', color: '#b74b45', active: true, metadata: { maintenanceStage: 'open' } }, { id: 'maintenance-status-in-progress', value: 'in_progress', label: 'In Progress', color: '#b38b3a', active: true, metadata: { maintenanceStage: 'inProgress' } }, { id: 'maintenance-status-completed', value: 'completed', label: 'Completed', color: '#2f8063', active: true, metadata: { maintenanceStage: 'completed' } }],
  trainingTypes: ['Service Excellence', 'Food Safety', 'Wine Knowledge'].map(value => ({ id: value, value, label: value, active: true })),
  trainingCategories: ['Service Standards', 'Menu Knowledge', 'Wine Knowledge', 'Upselling', 'Guest Experience', 'Hygiene', 'Safety', 'Other'].map(value => ({ id: `training-category-${value.toLowerCase().replaceAll(' ', '-')}`, value: value.toLowerCase().replaceAll(' ', '_'), label: value, active: true })),
  trainingStatuses: [{ id: 'training-status-planned', value: 'planned', label: 'Planned', color: '#b38b3a', active: true }, { id: 'training-status-completed', value: 'completed', label: 'Completed', color: '#1b6288', active: true }, { id: 'training-status-cancelled', value: 'cancelled', label: 'Cancelled', color: '#a7b0ba', active: true }],
  trainingAttendanceStatuses: [{ id: 'training-attendance-attended', value: 'attended', label: 'Attended', color: '#1b6288', active: true }, { id: 'training-attendance-absent', value: 'absent', label: 'Absent', color: '#b74b45', active: true }, { id: 'training-attendance-excused', value: 'excused', label: 'Excused', color: '#b38b3a', active: true }]
}
export const initialStaff: Staff[] = [
  { id: 's1', name: 'Ana Martínez', number: 'AND-001', position: 'Restaurant Supervisor', employmentStatus: 'active', joinDate: '2024-02-12' },
  { id: 's2', name: 'Mohamed Rasheed', number: 'AND-014', position: 'Waiter', employmentStatus: 'active', joinDate: '2024-08-06' },
  { id: 's3', name: 'Sofia García', number: 'AND-021', position: 'Host', employmentStatus: 'active', joinDate: '2025-01-15' },
  { id: 's4', name: 'Ibrahim Nasir', number: 'AND-028', position: 'Waiter', employmentStatus: 'active', joinDate: '2025-04-20' },
  { id: 's5', name: 'Elena Torres', number: 'AND-031', position: 'Waiter', employmentStatus: 'active', joinDate: '2025-06-03' },
  { id: 's6', name: 'David Romero', number: 'AND-009', position: 'Waiter', employmentStatus: 'inactive', joinDate: '2023-07-10', resignationDate: '2026-08-22' }
].map(person => ({ ...person, nationality: '', division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: '' }))
