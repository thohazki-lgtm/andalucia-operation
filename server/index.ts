import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { StaffRepository, type StaffConfigGroup } from './staff-repository.js'
import { OperationsRepository } from './operations-repository.js'
import { TrainingRepository } from './training-repository.js'
import { TrainingR2Service } from './training-r2-service.js'
import { TrainingSharePointConnection } from './training-sharepoint-connection.js'
import { BookingRepository, type BookingConfigGroup } from './booking-repository.js'
import { ChargeableRepository, type ChargeableConfigGroup } from './chargeable-repository.js'
import { WineSpiritsRepository } from './wine-spirits-repository.js'
import { GuestOccasionRepository, type GuestOccasionConfigGroup } from './guest-occasion-repository.js'
import { MaintenanceRepository, type MaintenanceConfigGroup } from './maintenance-repository.js'
import { ReportingRepository } from './reporting-repository.js'
import { DailyReportService } from './daily-report-service.js'
import { WeeklyReportService } from './weekly-report-service.js'
import { MonthlyReportService } from './monthly-report-service.js'
import { IncentivesRepository } from './incentives-repository.js'
import { FinancialPolicyInitializationService } from './financial-policy-initialization-service.js'
import { FinancialPreviewService } from './financial-preview-service.js'
import { BillTipWorkflowService } from './bill-tip-workflow-service.js'
import { OutletMembershipRepository } from './outlet-membership-repository.js'
import { StaffMembershipBaselineService } from './staff-membership-baseline-service.js'
import { LeavePlannerService } from './leave-planner-service.js'
import { assertTrustedOrigin, AuthError, AuthService, clearSessionCookie, LoginAttemptLimiter, parseSessionToken, requireAuthenticatedUser, sessionCookie } from './auth-service.js'
import { auditActorLabel, AuthorizationError, AuthorizationService } from './authorization-service.js'
import type { AttendanceRecord, AuthorizationPermissionKey, BookingImportReviewChanges, BookingImportReviewDecision, BookingRecord, ChargeableWriteRequest, ConfigOption, FinancialPreviewExternalAllocation, GuestOccasionRecord, MaintenanceRecord, PublicHoliday, ReportManagerSummary, ReportPeriodType, Staff, StaffEntitlement, StaffMembershipBaselineSelection, TrainingCompletionInput, TrainingDefaults, TrainingImportDecision, TrainingImportPreview, TrainingOperationalStatus, TrainingSession, WalkInBookingInput, WineSpiritSaleInput, WineSpiritSaleWriteRequest } from '../src/domain.js'
import { ACTIVITY_PROGRAM_PARSER_VERSION, parseActivityProgramPdf } from './activity-program-parser.js'
import { analyzeBookingCandidates, reconcileAnalyzedBookingCovers } from './booking-intelligence-engine.js'
import { parseTrainingCalendar } from './training-calendar-parser.js'
import { prepareTrainingImport } from './training-import-service.js'
import { serviceDate, weekRange } from '../src/service-date.js'
import { defaultBackupRoot, openVerifiedDatabase, publicDatabaseHealth, resolveRuntimeStore } from './database-protection.js'
import { startSchedulerShutdownControl } from './database-scheduler.js'
import { DatabaseBackupAdminService } from './database-backup-admin.js'
import { createOperationalFingerprint } from './database-backup.js'
import { DatabaseRecoveryService } from './database-recovery.js'
import { resolve } from 'node:path'

const runtimeStore = resolveRuntimeStore()
const guardedDatabase = await openVerifiedDatabase({ dataDirectory: runtimeStore.dataDirectory, role: runtimeStore.role, requiredVersion: process.env.ANDALUCIA_REQUIRED_SCHEMA_VERSION })
const databaseHealth = guardedDatabase.health
const repository = new StaffRepository(runtimeStore.dataDirectory, guardedDatabase.db)
const operations = new OperationsRepository(repository.getDatabase())
const training = new TrainingRepository(repository.getDatabase())
const trainingR2 = new TrainingR2Service(repository.getDatabase(), training)
const trainingSharePoint = new TrainingSharePointConnection()
const bookings = new BookingRepository(repository.getDatabase())
const chargeables = new ChargeableRepository(repository.getDatabase())
const wineSpirits = new WineSpiritsRepository(repository.getDatabase())
const occasions = new GuestOccasionRepository(repository.getDatabase())
const maintenance = new MaintenanceRepository(repository.getDatabase())
const reporting = new ReportingRepository(repository.getDatabase())
const dailyReports = new DailyReportService(repository.getDatabase(), reporting)
const weeklyReports = new WeeklyReportService(repository.getDatabase(), reporting)
const monthlyReports = new MonthlyReportService(repository.getDatabase(), reporting)
const incentives = new IncentivesRepository(repository.getDatabase())
const financialPolicy = new FinancialPolicyInitializationService(repository.getDatabase())
const financialPreview = new FinancialPreviewService(repository.getDatabase())
const outletMembership = new OutletMembershipRepository(repository.getDatabase())
const membershipBaseline = new StaffMembershipBaselineService(repository.getDatabase())
const leavePlanner = new LeavePlannerService(repository, outletMembership)
const authorization = new AuthorizationService(repository.getDatabase())
const auth = new AuthService(repository.getDatabase(), authorization)
const loginLimiter = new LoginAttemptLimiter()
const databaseBackupAdmin = new DatabaseBackupAdminService(defaultBackupRoot, runtimeStore.dataDirectory)
const databaseRecovery = new DatabaseRecoveryService({ recoveryRoot: resolve('.recovery'), backupRoot: defaultBackupRoot, canonicalDirectory: runtimeStore.dataDirectory, expectedCanonicalDirectory: runtimeStore.dataDirectory })
const billTipWorkflow = new BillTipWorkflowService(repository.getDatabase(), databaseHealth, databaseBackupAdmin, runtimeStore.dataDirectory, resolve('.recovery'))
const trainingPreviews = new Map<string, TrainingImportPreview>()
const valid = (input: Partial<Staff>): string | null => {
  if (!input.id || !input.number?.trim() || !input.name?.trim() || !input.position || !input.employmentStatus || !input.joinDate) return 'Employee ID, name, designation, employment status and date of joining are required.'
  if (!validCalendarDate(input.joinDate)) return 'Select a valid date of joining.'
  if (input.resignationDate && !validCalendarDate(input.resignationDate)) return 'Select a valid separation date.'
  if (input.resignationDate && input.resignationDate < input.joinDate) return 'Resignation date cannot be before the join date.'
  return null
}
const body = async (request: import('node:http').IncomingMessage): Promise<unknown> => new Promise((resolve, reject) => { let raw = ''; request.on('data', chunk => { raw += chunk }); request.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { reject(new Error('Invalid JSON request body.')) } }); request.on('error', reject) })
const binaryBody = async (request: import('node:http').IncomingMessage, maximumBytes = 20 * 1024 * 1024): Promise<Buffer> => new Promise((resolve, reject) => { const chunks: Buffer[] = []; let size = 0; request.on('data', chunk => { const value = Buffer.from(chunk); size += value.length; if (size > maximumBytes) { request.destroy(); reject(new Error('The PDF exceeds the 20 MB upload limit.')); return } chunks.push(value) }); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject) })
const send = (response: import('node:http').ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', ...headers }); response.end(status === 204 ? undefined : JSON.stringify(payload)) }
const validCalendarDate = (value: string) => { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return false; const [, year, month, day] = match.map(Number); const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day }
const expectedErrorStatus = (error: unknown): 400 | 409 | null => {
  if (!(error instanceof Error)) return null
  if (/^A clear correction reason is required/.test(error.message)) return 400
  if (/^(Realized and cancelled|Chargeable request identity already belongs)/.test(error.message)) return 409
  if (/^(Invalid JSON request body\.|Invalid calendar date:|MONTHLY_REPORT_MONTH_INVALID|MONTHLY_REPORT_MONTH_START_INVALID|MONTHLY_FINANCE_VALUE_INVALID|MONTHLY_FINANCE_REQUIRED_FIELDS_MISSING|The PDF exceeds|Select a valid report|Select a valid Daily Report|Select a valid Weekly Report|Weekly commentary must|Daily Report service date|Select a valid Wine\/Spirits|Select a valid Service Date|Service Date, Check|Quantity must|Gross unit price|Select a valid holiday year|Select a valid entitlement year|Reports are limited|Display code, duty name|Select a valid duty color|Entitlement values must|Holiday name, valid date|Unsupported training calendar|Image calendar OCR|Training topic, date|End time must|Trainer is required|No training records|Select a valid Training month|Training target policy is unavailable|Enter a valid actual Training duration|Review every eligible staff member|Resolve eligibility for|Confirm participation for|Baseline month must|Select a valid baseline|A selected baseline membership|A selected baseline membership begins|A selected baseline membership exceeds|Select at least one regular staff|A reset reason|A correction reason|Walk-in covers|Select a valid Walk-in|Enter a valid table range|This table range overlaps|Protected Walk-in|System-controlled Walk-in|.* is required for this Walk-in)/.test(error.message)) return 400
  if (/^(Inactive |MAINTENANCE_CONCURRENCY_CONFLICT|Maintenance R2 requires|Completed Maintenance issues|Move an Open issue|In Progress issues|New Maintenance issues|Maintenance workflow identities|Only the display color|An active Maintenance Area|MONTHLY_REPORT_CONCURRENCY_CONFLICT|MONTHLY_REPORT_INPUT_NOT_FOUND|MONTHLY_REPORT_OUTLET_SCOPE_REJECTED|The selected .* no longer exists\.|A selected staff member no longer exists\.|This staff member is not eligible|This booking already has|Training session not found\.|Training completion has already been confirmed\.|Cancelled Training cannot be confirmed|Active training import batch not found\.|Training import preview was not found\.|Chargeable record not found\.|Import preview batch was not found\.|This preview batch has no parsed records\.|Select at least one booking to import\.|Select (a configured|an active)|Attendance can only be recorded|That display code is already in use\.|That Employee ID already belongs|Duty code not found\.|Staff member not found\.|Public holiday not found\.|Outlet scope not found\.|Baseline review not found\.|Daily Report|Save the Daily Report|Approved Daily Reports|Only Reviewed reports|A current Daily Report|An approved baseline|A correction revision|Only the current approved|Baseline outlet or month|A selected Staff UUID|A selected Staff member has|Baseline approval state changed|BILL_TIP_|FINANCIAL_POLICY_INITIALIZATION_BLOCKED|Month still in progress\.|The total Bill Tip pool|Historical roster|Bill Tip reconciliation|A Bill Tip version|Only an active correction|Only the current finalized)/.test(error.message)) return 409
  return null
}

await repository.assertCompatibleSchema()
await incentives.initialize()
await bookings.initialize()
await occasions.initialize()
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (request.method === 'GET' && url.pathname === '/api/health') return send(response, 200, { ok: true, database: publicDatabaseHealth(databaseHealth) }, { 'Cache-Control': 'no-store' })
    if (request.method === 'GET' && url.pathname === '/api/database/health') { const principal = await requireAuthenticatedUser(request, auth); await authorization.requirePermission(principal, 'manage_platform'); const summary = await databaseBackupAdmin.summary(databaseHealth); return send(response, 200, { ...summary, recovery: await databaseRecovery.summary(databaseHealth) }, { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/database/backups') { const principal = await requireAuthenticatedUser(request, auth); await authorization.requirePermission(principal, 'manage_platform'); return send(response, 200, await databaseBackupAdmin.inventory(), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'POST' && url.pathname === '/api/database/backups/request') { assertTrustedOrigin(request); const principal = await requireAuthenticatedUser(request, auth); await authorization.requirePermission(principal, 'manage_platform'); return send(response, 202, await databaseBackupAdmin.requestManualBackup(principal)) }
    const backupAdminMatch = url.pathname.match(/^\/api\/database\/backups\/([^/]+)\/(pin|unpin|restore-rehearsal|inspect)$/)
    if (request.method === 'POST' && backupAdminMatch) { assertTrustedOrigin(request); const principal = await requireAuthenticatedUser(request, auth); await authorization.requirePermission(principal, 'manage_platform'); if (backupAdminMatch[2] === 'restore-rehearsal') return send(response, 200, await databaseBackupAdmin.rehearse(backupAdminMatch[1], principal)); if (backupAdminMatch[2] === 'inspect') return send(response, 200, await databaseBackupAdmin.inspect(backupAdminMatch[1], principal)); const input = await body(request) as { reason?: string }; return send(response, 200, await databaseBackupAdmin.pin(backupAdminMatch[1], backupAdminMatch[2] === 'pin', principal, input.reason || '')) }
    const recoveryMatch = url.pathname.match(/^\/api\/database\/recovery\/incidents\/([^/]+)\/(preview|select|rehearse|authorize|accept)$/)
    if (recoveryMatch) { const principal = await requireAuthenticatedUser(request, auth); await authorization.requirePermission(principal, 'manage_platform'); if (!principal.isOwner) throw new AuthorizationError('FORBIDDEN', 'Owner authority is required for database recovery.'); const incidentId = recoveryMatch[1]; const action = recoveryMatch[2]; if (request.method === 'GET' && action === 'preview') return send(response, 200, await databaseRecovery.preview(incidentId), { 'Cache-Control': 'no-store' }); if (request.method === 'POST') { assertTrustedOrigin(request); const input = await body(request) as { backupId?: string; rollbackBackupId?: string; confirmation?: string }; if (action === 'select') return send(response, 200, await databaseRecovery.selectCandidate(incidentId, input.backupId || '', principal)); if (action === 'rehearse') return send(response, 200, await databaseRecovery.rehearse(incidentId, principal)); if (action === 'authorize') return send(response, 200, await databaseRecovery.authorize(incidentId, { confirmation: input.confirmation || '', rollbackBackupId: input.rollbackBackupId || '' }, principal)); if (action === 'accept') return send(response, 200, await databaseRecovery.accept(incidentId, principal, await createOperationalFingerprint(repository.getDatabase()))) } }
    if (request.method === 'GET' && url.pathname === '/api/auth/bootstrap-status') return send(response, 200, { accountConfigured: await auth.hasAccounts() }, { 'Cache-Control': 'no-store' })
    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      assertTrustedOrigin(request)
      const input = await body(request) as { identifier?: string; password?: string }
      const limiterKey = `${request.socket.remoteAddress || 'unknown'}|${(input.identifier || '').normalize('NFKC').trim().toLowerCase()}`
      loginLimiter.assertAllowed(limiterKey)
      try { const signedIn = await auth.login(input.identifier || '', input.password || ''); loginLimiter.succeeded(limiterKey); return send(response, 200, signedIn.user, { 'Set-Cookie': sessionCookie(signedIn.token), 'Cache-Control': 'no-store' }) }
      catch (error) { if (error instanceof AuthError && error.code === 'INVALID_LOGIN') loginLimiter.failed(limiterKey); throw error }
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/logout') { assertTrustedOrigin(request); await auth.logout(parseSessionToken(request)); return send(response, 204, null, { 'Set-Cookie': clearSessionCookie(), 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/auth/me') { const principal = await requireAuthenticatedUser(request, auth); return send(response, 200, await auth.currentUser(principal.userId), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/auth/protected-test') { const principal = await requireAuthenticatedUser(request, auth); return send(response, 200, { userId: principal.userId, displayName: principal.displayName, sessionId: principal.sessionId }, { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/auth/roles') { const principal = await requireAuthenticatedUser(request, auth); await authorization.requirePermission(principal, 'manage_roles_permissions'); return send(response, 200, await authorization.roles(), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/auth/permissions') { const principal = await requireAuthenticatedUser(request, auth); await authorization.requirePermission(principal, 'manage_roles_permissions'); return send(response, 200, await authorization.permissions(), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'POST' && url.pathname === '/api/financial-policy/initialize') { assertTrustedOrigin(request); const principal = await requireAuthenticatedUser(request, auth); const outlet = await outletMembership.findOutletByKey('andalucia'); if (!outlet) throw new Error('FINANCIAL_POLICY_INITIALIZATION_BLOCKED:ANDALUCIA_OUTLET_SCOPE_NOT_FOUND'); await authorization.requireOutletPermission(principal, 'manage_financial_rules', outlet.id); return send(response, 200, await financialPolicy.initialize(outlet.id, principal), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'POST' && url.pathname === '/api/financial-preview') { assertTrustedOrigin(request); const input = await body(request) as { month?: string; totalPool?: string; externalAllocations?: FinancialPreviewExternalAllocation[] }; const principal = await requireAuthenticatedUser(request, auth); const outlet = await outletMembership.findOutletByKey('andalucia'); if (!outlet) throw new Error('Financial preview outlet was not found.'); await authorization.requireOutletPermission(principal, 'manage_bill_tips', outlet.id); await authorization.requireOutletPermission(principal, 'manage_incentives', outlet.id); return send(response, 200, await financialPreview.preview({ month: input.month || serviceDate().slice(0, 7), outletScopeId: outlet.id, totalPool: input.totalPool || '0.00', externalAllocations: Array.isArray(input.externalAllocations) ? input.externalAllocations : [] }), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/wine-spirits') { const context = await authorizedWineSpiritsContext(request); const start = url.searchParams.get('start') || `${serviceDate().slice(0, 7)}-01`; const end = url.searchParams.get('end') || serviceDate(); return send(response, 200, await wineSpirits.list({ start, end, outletScopeId: context.outlet.id }), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'POST' && url.pathname === '/api/wine-spirits/calculate') { assertTrustedOrigin(request); const context = await authorizedWineSpiritsContext(request); const input = await body(request) as WineSpiritSaleInput; return send(response, 200, await wineSpirits.calculate(input, context.outlet.id), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'POST' && url.pathname === '/api/wine-spirits/duplicate-review') { assertTrustedOrigin(request); const context = await authorizedWineSpiritsContext(request); const input = await body(request) as WineSpiritSaleInput; return send(response, 200, await wineSpirits.duplicateWarnings(input, context.outlet.id), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'POST' && url.pathname === '/api/wine-spirits') { assertTrustedOrigin(request); const context = await authorizedWineSpiritsContext(request); const input = await body(request) as WineSpiritSaleWriteRequest; if (!input.id) return send(response, 400, { message: 'Wine/Spirits record identity is required.' }); return send(response, 201, await wineSpirits.save(input, { outletScopeId: context.outlet.id, actor: context.principal })) }
    const wineAuditMatch = url.pathname.match(/^\/api\/wine-spirits\/([^/]+)\/audit$/)
    if (request.method === 'GET' && wineAuditMatch) { const context = await authorizedWineSpiritsContext(request); return send(response, 200, await wineSpirits.auditHistory(wineAuditMatch[1], context.outlet.id), { 'Cache-Control': 'no-store' }) }
    const wineMatch = url.pathname.match(/^\/api\/wine-spirits\/([^/]+)$/)
    if (request.method === 'PUT' && wineMatch) { assertTrustedOrigin(request); const context = await authorizedWineSpiritsContext(request); const input = await body(request) as WineSpiritSaleWriteRequest; return send(response, 200, await wineSpirits.save({ ...input, id: wineMatch[1] }, { outletScopeId: context.outlet.id, actor: context.principal })) }
    if (request.method === 'DELETE' && wineMatch) { assertTrustedOrigin(request); const context = await authorizedWineSpiritsContext(request); const input = await body(request) as { correctionReason?: string }; return send(response, 200, await wineSpirits.archive(wineMatch[1], { outletScopeId: context.outlet.id, actor: context.principal }, input.correctionReason || '')) }
    if (request.method === 'GET' && url.pathname === '/api/bill-tips/workflow') { const principal = await requireAuthenticatedUser(request, auth); const outlet = await authorizedBillTipOutlet(principal, 'manage_bill_tips'); const month = url.searchParams.get('month') || serviceDate().slice(0, 7); if (!/^\d{4}-\d{2}$/.test(month)) return send(response, 400, { message: 'Select a valid Bill Tip month.' }); return send(response, 200, await billTipWorkflow.state(month, { id: outlet.id, key: outlet.scopeKey, name: outlet.displayName }), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'POST' && url.pathname === '/api/bill-tips/finalize') { assertTrustedOrigin(request); const principal = await requireAuthenticatedUser(request, auth); const outlet = await authorizedBillTipOutlet(principal, 'manage_bill_tips'); const input = await body(request) as { month?: string; totalPool?: string; externalAllocations?: FinancialPreviewExternalAllocation[]; backupId?: string; confirmation?: string; idempotencyKey?: string }; if (!input.month || input.confirmation !== `FINALIZE BILL TIPS ${input.month}`) return send(response, 400, { message: 'Enter the exact finalization confirmation shown.' }); return send(response, 201, await billTipWorkflow.finalize({ month: input.month, totalPool: input.totalPool || '0.00', externalAllocations: Array.isArray(input.externalAllocations) ? input.externalAllocations : [], backupId: input.backupId, idempotencyKey: input.idempotencyKey || '' }, outlet.id, principal), { 'Cache-Control': 'no-store' }) }
    const billTipVersionMatch = url.pathname.match(/^\/api\/bill-tips\/versions\/([^/]+)$/)
    if (request.method === 'GET' && billTipVersionMatch) { const principal = await requireAuthenticatedUser(request, auth); const outlet = await authorizedBillTipOutlet(principal, 'manage_bill_tips'); const version = await billTipWorkflow.finalization.version(billTipVersionMatch[1]); if (!version || version.outletScopeId !== outlet.id) return send(response, 404, { message: 'Bill Tip version not found.' }); return send(response, 200, version, { 'Cache-Control': 'no-store' }) }
    const billTipDiffMatch = url.pathname.match(/^\/api\/bill-tips\/versions\/([^/]+)\/diff$/)
    if (request.method === 'GET' && billTipDiffMatch) { const principal = await requireAuthenticatedUser(request, auth); const outlet = await authorizedBillTipOutlet(principal, 'manage_bill_tips'); const version = await billTipWorkflow.finalization.version(billTipDiffMatch[1]); if (!version || version.outletScopeId !== outlet.id) return send(response, 404, { message: 'Bill Tip version not found.' }); return send(response, 200, await billTipWorkflow.finalization.diff(version.id), { 'Cache-Control': 'no-store' }) }
    const billTipActionMatch = url.pathname.match(/^\/api\/bill-tips\/versions\/([^/]+)\/(reopen|refinalize)$/)
    if (request.method === 'POST' && billTipActionMatch) { assertTrustedOrigin(request); const principal = await requireAuthenticatedUser(request, auth); const outlet = await authorizedBillTipOutlet(principal, 'perform_financial_corrections'); await authorization.requireOutletPermission(principal, 'manage_bill_tips', outlet.id); if (!principal.isOwner) throw new AuthorizationError('FORBIDDEN', 'Owner authority is required for Bill Tip corrections.'); const input = await body(request) as { reason?: string; correctionKey?: string; month?: string; totalPool?: string; externalAllocations?: FinancialPreviewExternalAllocation[]; backupId?: string; confirmation?: string; idempotencyKey?: string }; if (billTipActionMatch[2] === 'reopen') { if (input.confirmation !== 'REOPEN BILL TIPS FOR CORRECTION') return send(response, 400, { message: 'Enter the exact correction confirmation shown.' }); return send(response, 201, await billTipWorkflow.reopen(billTipActionMatch[1], input.reason || '', input.correctionKey || '', { outletScopeId: outlet.id, actor: principal }), { 'Cache-Control': 'no-store' }) } const version = await billTipWorkflow.finalization.version(billTipActionMatch[1]); if (!version || input.confirmation !== `RE-FINALIZE BILL TIPS ${version.month}`) return send(response, 400, { message: 'Enter the exact re-finalization confirmation shown.' }); return send(response, 200, await billTipWorkflow.refinalize(version.id, { month: version.month, totalPool: input.totalPool || '0.00', externalAllocations: Array.isArray(input.externalAllocations) ? input.externalAllocations : [], backupId: input.backupId, idempotencyKey: input.idempotencyKey || '' }, { outletScopeId: outlet.id, actor: principal }), { 'Cache-Control': 'no-store' }) }
    const userAuthorizationMatch = url.pathname.match(/^\/api\/auth\/users\/([^/]+)\/authorization$/)
    if (request.method === 'GET' && userAuthorizationMatch) { const principal = await requireAuthenticatedUser(request, auth); await authorization.requirePermission(principal, 'manage_users'); return send(response, 200, await authorization.authorizationForUser(userAuthorizationMatch[1]), { 'Cache-Control': 'no-store' }) }
    const baselineReadMatch = url.pathname.match(/^\/api\/staff-membership\/baselines\/([^/]+)\/(\d{4}-\d{2})\/(preview|status)$/)
    if (request.method === 'GET' && baselineReadMatch) return send(response, 200, baselineReadMatch[3] === 'preview' ? await membershipBaseline.preview(baselineReadMatch[2], baselineReadMatch[1]) : await membershipBaseline.status(baselineReadMatch[2], baselineReadMatch[1]))
    const baselineHistoryMatch = url.pathname.match(/^\/api\/staff-membership\/baselines\/([^/]+)\/(\d{4}-\d{2})\/history$/)
    if (request.method === 'GET' && baselineHistoryMatch) return send(response, 200, await membershipBaseline.history(baselineHistoryMatch[2], baselineHistoryMatch[1]))
    if (request.method === 'POST' && url.pathname === '/api/staff-membership/baseline-reviews') { const input = await body(request) as { month?: string; outletScopeKey?: string }; const principal = await requireAuthenticatedUser(request, auth); const outlet = await outletMembership.findOutletByKey(input.outletScopeKey || ''); if (!outlet) throw new Error('Outlet scope not found.'); await authorization.requireOutletPermission(principal, 'manage_staff_membership_baseline', outlet.id); return send(response, 200, await membershipBaseline.beginReview(input.month || '', input.outletScopeKey || '', principal)) }
    const baselineSelectionMatch = url.pathname.match(/^\/api\/staff-membership\/baseline-reviews\/([^/]+)\/selections\/([^/]+)$/)
    if (request.method === 'PUT' && baselineSelectionMatch) { const input = await body(request) as Partial<StaffMembershipBaselineSelection>; const principal = await authorizeBaselineReview(request, baselineSelectionMatch[1], 'manage_staff_membership_baseline'); return send(response, 200, await membershipBaseline.saveSelection(baselineSelectionMatch[1], { staffId: baselineSelectionMatch[2], included: Boolean(input.included), effectiveFrom: input.effectiveFrom || '', effectiveTo: input.effectiveTo || null, reviewNote: input.reviewNote }, principal)) }
    if (request.method === 'DELETE' && baselineSelectionMatch) { const principal = await authorizeBaselineReview(request, baselineSelectionMatch[1], 'manage_staff_membership_baseline'); await membershipBaseline.removeSelection(baselineSelectionMatch[1], baselineSelectionMatch[2], principal); return send(response, 204, null) }
    const baselineDiffMatch = url.pathname.match(/^\/api\/staff-membership\/baseline-reviews\/([^/]+)\/diff$/)
    if (request.method === 'GET' && baselineDiffMatch) return send(response, 200, await membershipBaseline.diff(baselineDiffMatch[1]))
    const baselineActionMatch = url.pathname.match(/^\/api\/staff-membership\/baseline-reviews\/([^/]+)\/(approve|reset|reopen)$/)
    if (request.method === 'POST' && baselineActionMatch) { const input = await body(request) as { reason?: string; outletScopeId?: string; month?: string }; const action=baselineActionMatch[2]; const permission: AuthorizationPermissionKey = action === 'approve' ? 'approve_staff_membership_baseline' : action === 'reopen' ? 'reopen_staff_membership_baseline' : 'manage_staff_membership_baseline'; const principal = await authorizeBaselineReview(request, baselineActionMatch[1], permission); if (action === 'approve') return send(response, 200, await membershipBaseline.approve(baselineActionMatch[1], principal)); if(action==='reopen') return send(response, 201, await membershipBaseline.reopen(baselineActionMatch[1], { reason:input.reason||'', outletScopeId:input.outletScopeId||'', month:input.month||'' }, principal)); await membershipBaseline.resetReview(baselineActionMatch[1], input.reason || '', principal); return send(response, 200, { reset: true }) }
    if (request.method === 'GET' && url.pathname === '/api/staff') return send(response, 200, await repository.list())
    if (request.method === 'GET' && url.pathname === '/api/training') { await authorizedTrainingContext(request); return send(response, 200, await trainingR2.list(), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/training/performance') { await authorizedTrainingContext(request); return send(response, 200, await trainingR2.performance(url.searchParams.get('month') || serviceDate().slice(0, 7)), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/training/sharepoint/status') { await authorizedTrainingContext(request); return send(response, 200, trainingSharePoint.diagnostic(), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'POST' && url.pathname === '/api/training/import-preview') {
      assertTrustedOrigin(request); await authorizedTrainingContext(request)
      const data = await binaryBody(request); const fileName = (url.searchParams.get('filename') || 'training-calendar').slice(0, 240)
      const fileHash = createHash('sha256').update(data).digest('hex'); const parsed = await parseTrainingCalendar(new Uint8Array(data), fileName)
      if (!parsed.records.length) return send(response, 422, { message: 'No training records could be extracted from this file.' })
      const activeHashBatch = await training.importBatchByHash(fileHash); const duplicateFile = Boolean(activeHashBatch); const seen = new Set<string>(); let duplicatesWithinFile = 0
      const records = await Promise.all(parsed.records.map(async record => { const key = `${record.date}|${record.topic.trim().toLowerCase()}|${record.startTime}|${record.endTime}`; const withinFile = seen.has(key); seen.add(key); if (withinFile) duplicatesWithinFile++; const duplicateTrainingId = record.date && record.topic && record.startTime && record.endTime ? await training.findDuplicate(record.date, record.topic, record.startTime, record.endTime) : null; return { ...record, readiness: duplicateFile || duplicateTrainingId || withinFile ? 'DUPLICATE' as const : record.readiness, duplicateTrainingId: duplicateTrainingId || undefined, duplicateWithinFile: withinFile } }))
      let existingImport = activeHashBatch ? await training.importBatch(activeHashBatch.id) : undefined
      if (!existingImport) { for (const item of records) { if (!item.duplicateTrainingId) continue; const batch = await training.importBatchForTraining(item.duplicateTrainingId); if (batch?.active) { existingImport = batch; break } } }
      const preview: TrainingImportPreview = { batchId: randomUUID(), fileName, fileHash, fileType: parsed.fileType, duplicateFile, records, existingImport: existingImport || undefined, replacementSummary: { ready: Math.max(0, parsed.records.filter(item => item.readiness === 'READY').length - duplicatesWithinFile), requiresReview: parsed.records.filter(item => item.readiness === 'REVIEW_REQUIRED').length, duplicatesWithinFile }, summary: { detected: records.length, ready: records.filter(item => item.readiness === 'READY').length, requiresReview: records.filter(item => item.readiness === 'REVIEW_REQUIRED').length, duplicates: records.filter(item => item.readiness === 'DUPLICATE').length } }
      trainingPreviews.set(preview.batchId, preview); return send(response, 200, preview)
    }
    if (request.method === 'POST' && url.pathname === '/api/training/confirm-import') {
      assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const actor = auditActorLabel(context.principal)
      const input = await body(request) as { batchId?: string; decisions?: TrainingImportDecision[] }; const preview = input.batchId ? trainingPreviews.get(input.batchId) : undefined
      if (!preview) return send(response, 409, { message: 'Training import preview was not found. Parse the file again.' })
      if (!Array.isArray(input.decisions)) return send(response, 400, { message: 'Training import decisions are required.' })
      const { pending, skipped, duplicates } = await prepareTrainingImport(training, preview, input.decisions); const importedIds: string[] = []
      if (pending.length) { await training.createImportBatch(preview.batchId, preview.fileName, preview.fileHash, preview.fileType, actor); for (const session of pending) { await training.save(session, actor); importedIds.push(session.id) } }
      trainingPreviews.delete(preview.batchId); return send(response, 200, { imported: importedIds.length, skipped, duplicates, failed: 0, importedIds })
    }
    if (request.method === 'POST' && url.pathname === '/api/training/replace-import') {
      assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const actor = auditActorLabel(context.principal)
      const input = await body(request) as { batchId?: string; existingBatchId?: string; decisions?: TrainingImportDecision[] }; const preview = input.batchId ? trainingPreviews.get(input.batchId) : undefined
      if (!preview || !input.existingBatchId) return send(response, 409, { message: 'Training import preview was not found. Parse the file again.' })
      if (!Array.isArray(input.decisions)) return send(response, 400, { message: 'Training import decisions are required.' })
      const existing = await training.importBatch(input.existingBatchId); if (!existing?.active) throw new Error('Active training import batch not found.')
      const allowedDuplicateIds = new Set(existing.sessions.filter(session => session.active).map(session => session.id)); const { pending, skipped, duplicates } = await prepareTrainingImport(training, preview, input.decisions, { replacing: true, allowedDuplicateIds })
      if (!pending.length) return send(response, 400, { message: 'No training records are ready to replace the existing import.' })
      const replaced = await training.replaceImportBatch(existing.id, { id: preview.batchId, fileName: preview.fileName, fileHash: preview.fileHash, fileType: preview.fileType }, pending, actor)
      trainingPreviews.delete(preview.batchId); return send(response, 200, { imported: replaced.importedIds.length, skipped, duplicates, failed: 0, importedIds: replaced.importedIds, previousImportRemoved: replaced.removed })
    }
    const trainingImportBatchMatch = url.pathname.match(/^\/api\/training\/import-batches\/([^/]+)$/)
    if (request.method === 'GET' && trainingImportBatchMatch) { await authorizedTrainingContext(request); const batch = await training.importBatch(trainingImportBatchMatch[1]); if (!batch) throw new Error('Active training import batch not found.'); return send(response, 200, batch) }
    if (request.method === 'DELETE' && trainingImportBatchMatch) { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const removed = await training.removeImportBatch(trainingImportBatchMatch[1], auditActorLabel(context.principal)); return send(response, 200, { imported: 0, skipped: 0, duplicates: 0, failed: 0, importedIds: [], removed }) }
    if (request.method === 'GET' && url.pathname === '/api/bookings') return send(response, 200, await bookings.list(url.searchParams.get('date') || serviceDate()))
    if (request.method === 'GET' && url.pathname === '/api/bookings/summary') return send(response, 200, await bookings.summary(url.searchParams.get('date') || serviceDate()))
    if (request.method === 'GET' && url.pathname === '/api/chargeables') { const context = await authorizedChargeableContext(request); return send(response, 200, await chargeables.list(url.searchParams.get('date') || serviceDate(), context.outlet.id)) }
    if (request.method === 'GET' && url.pathname === '/api/chargeables/summary') { const context = await authorizedChargeableContext(request); return send(response, 200, await chargeables.summary(url.searchParams.get('date') || serviceDate(), context.outlet.id)) }
    if (request.method === 'GET' && url.pathname === '/api/guest-occasions') { const context = await authorizedGuestOccasionsContext(request); return send(response, 200, await occasions.list(url.searchParams.get('date') || serviceDate(), context.outlet.scopeKey)) }
    if (request.method === 'GET' && url.pathname === '/api/guest-occasions/summary') { const context = await authorizedGuestOccasionsContext(request); return send(response, 200, await occasions.summary(url.searchParams.get('date') || serviceDate())) }
    if (request.method === 'GET' && url.pathname === '/api/guest-experience') { const context = await authorizedGuestOccasionsContext(request); return send(response, 200, await occasions.experience(url.searchParams.get('date') || serviceDate(), context.outlet.id, context.outlet.scopeKey), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/maintenance') { const context = await authorizedMaintenanceContext(request); return send(response, 200, await maintenance.list(context.outlet.id)) }
    if (request.method === 'GET' && url.pathname === '/api/maintenance/summary') { const context = await authorizedMaintenanceContext(request); return send(response, 200, await maintenance.summary(url.searchParams.get('date') || serviceDate(), context.outlet.id)) }
    if (request.method === 'GET' && url.pathname === '/api/reports/daily') { const context = await authorizedReportsContext(request); const date = url.searchParams.get('date') || serviceDate(); if (!validCalendarDate(date)) return send(response, 400, { message: 'Select a valid Daily Report service date.' }); return send(response, 200, await dailyReports.view(date, context.outlet), { 'Cache-Control': 'no-store' }) }
    const dailyReportAction = url.pathname.match(/^\/api\/reports\/daily\/(\d{4}-\d{2}-\d{2})\/(draft|review|approve)$/)
    if (dailyReportAction && request.method === (dailyReportAction[2] === 'draft' ? 'PUT' : 'POST')) { assertTrustedOrigin(request); const context = await authorizedReportsContext(request); if (!validCalendarDate(dailyReportAction[1])) return send(response, 400, { message: 'Select a valid Daily Report service date.' }); const input = await body(request) as { manualPayload?: unknown; idempotencyKey?: string }; if (dailyReportAction[2] === 'draft') return send(response, 200, await dailyReports.saveDraft(dailyReportAction[1], input.manualPayload, context.outlet, context.principal), { 'Cache-Control': 'no-store' }); if (dailyReportAction[2] === 'review') return send(response, 200, await dailyReports.review(dailyReportAction[1], context.outlet, context.principal), { 'Cache-Control': 'no-store' }); return send(response, 200, await dailyReports.approve(dailyReportAction[1], input.idempotencyKey || '', context.outlet, context.principal), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/reports/weekly') { const context = await authorizedReportsContext(request); const date = url.searchParams.get('date') || serviceDate(); if (!validCalendarDate(date)) return send(response, 400, { message: 'Select a valid Weekly Report date.' }); return send(response, 200, await weeklyReports.view(date, context.outlet), { 'Cache-Control': 'no-store' }) }
    const weeklyCommentary = url.pathname.match(/^\/api\/reports\/weekly\/(\d{4}-\d{2}-\d{2})\/commentary$/)
    if (request.method === 'PUT' && weeklyCommentary) { assertTrustedOrigin(request); const context = await authorizedReportsContext(request); if (!validCalendarDate(weeklyCommentary[1])) return send(response, 400, { message: 'Select a valid Weekly Report date.' }); const input = await body(request) as { managerNotes?: string }; return send(response, 200, await weeklyReports.saveCommentary(weeklyCommentary[1], input.managerNotes || '', context.outlet, auditActorLabel(context.principal)), { 'Cache-Control': 'no-store' }) }
    if(request.method==='GET'&&url.pathname==='/api/reports/monthly'){const context=await authorizedReportsContext(request);return send(response,200,await monthlyReports.view(url.searchParams.get('month')||serviceDate().slice(0,7),context.outlet),{'Cache-Control':'no-store'})}
    const monthlyRoute=url.pathname.match(/^\/api\/reports\/monthly\/(\d{4}-\d{2})(\/verify)?$/)
    if(monthlyRoute&&request.method===(monthlyRoute[2]?'POST':'PUT')){assertTrustedOrigin(request);const context=await authorizedReportsContext(request),input=await body(request) as {expectedRevision?:number|null;financePayload?:unknown;managerCommentary?:string;followUpsChanges?:string};if(monthlyRoute[2])return send(response,200,await monthlyReports.verify(monthlyRoute[1],Number(input.expectedRevision),context.outlet,context.principal),{'Cache-Control':'no-store'});return send(response,200,await monthlyReports.save(monthlyRoute[1],{expectedRevision:input.expectedRevision??null,financePayload:input.financePayload,managerCommentary:input.managerCommentary,followUpsChanges:input.followUpsChanges},context.outlet,context.principal),{'Cache-Control':'no-store'})}
    if (request.method === 'GET' && url.pathname === '/api/reports') { const start = url.searchParams.get('start') || serviceDate(); const end = url.searchParams.get('end') || serviceDate(); if (!validCalendarDate(start) || !validCalendarDate(end) || start > end) return send(response, 400, { message: 'Select a valid report date range.' }); return send(response, 200, await reporting.report((url.searchParams.get('periodType') || 'today') as ReportPeriodType, start, end)) }
    if (request.method === 'POST' && url.pathname === '/api/bookings/import-preview') {
      assertTrustedOrigin(request)
      const context = await authorizedBookingsContext(request)
      const pdf = await binaryBody(request)
      if (pdf.length < 5 || pdf.subarray(0, 5).toString() !== '%PDF-') return send(response, 400, { message: 'Select a valid PDF Activity Program.' })
      const parsed = await parseActivityProgramPdf(new Uint8Array(pdf))
      if (!parsed.bookings.length) return send(response, 422, { message: 'No structurally identified Andalucía bookings were found in this PDF.' })
      const analyzedBookings = analyzeBookingCandidates(parsed.bookings, (await occasions.configuration()).types)
      const coverReconciliation = reconcileAnalyzedBookingCovers(analyzedBookings, parsed.validation.declaredCovers)
      const structuralReconciled = Boolean(parsed.reportDate) && analyzedBookings.length === parsed.validation.declaredBookingGroups
      const validationMessages = parsed.validation.messages.filter(message => !/Pre-intelligence booking candidates total/i.test(message))
      validationMessages.push(`Header covers ${coverReconciliation.rawSectionHeaderTotal} + ${coverReconciliation.positiveAdjustments} deterministic adjustments - ${coverReconciliation.exclusions} deterministic exclusions = ${coverReconciliation.effectiveOperationalTotal} operational cover candidates.`)
      if (coverReconciliation.sourceBookingTotal !== coverReconciliation.rawSectionHeaderTotal) validationMessages.push(`Parsed source PAX totals ${coverReconciliation.sourceBookingTotal}, which does not match ${coverReconciliation.rawSectionHeaderTotal} raw section-header covers.`)
      if (coverReconciliation.unresolvedRecords) validationMessages.push(`Cover arithmetic is reconciled, but ${coverReconciliation.unresolvedRecords} booking${coverReconciliation.unresolvedRecords === 1 ? '' : 's'} still require manager confirmation.`)
      const validation = { ...parsed.validation, reconciled: structuralReconciled && coverReconciliation.reconciled, messages: [...new Set(validationMessages)], coverReconciliation }
      const fileName = (url.searchParams.get('filename') || 'activity-program.pdf').slice(0, 240)
      const base = { fileName, fileHash: createHash('sha256').update(pdf).digest('hex'), reportDate: parsed.reportDate, parserVersion: ACTIVITY_PROGRAM_PARSER_VERSION, summary: { bookingGroups: analyzedBookings.length, totalCovers: coverReconciliation.effectiveOperationalTotal, confirmed: analyzedBookings.filter(booking => booking.sourceStatus.toLowerCase() === 'confirmed').length, pending: analyzedBookings.filter(booking => booking.sourceStatus.toLowerCase() === 'pending').length, warnings: analyzedBookings.filter(booking => booking.warnings.length > 0).length, possibleDuplicates: 0 }, validation, bookings: analyzedBookings }
      return send(response, 200, await bookings.prepareImportPreview(base, auditActorLabel(context.principal)))
    }
    if (request.method === 'POST' && url.pathname === '/api/bookings/reanalyze-import-preview') {
      assertTrustedOrigin(request)
      await authorizedBookingsContext(request)
      const input = await body(request) as { batchId?: string }
      if (!input.batchId) return send(response, 400, { message: 'Import batch is required for duplicate intelligence re-analysis.' })
      const candidates = await bookings.duplicateReanalysisCandidates(input.batchId)
      const occasionTypes = (await occasions.configuration()).types
      const sourceAnalyzed = analyzeBookingCandidates(candidates.map(item => item.source), occasionTypes)
      const existingAnalyzed = analyzeBookingCandidates(candidates.map(item => item.existing), occasionTypes)
      const records = candidates.map((item, index) => {
        const detected = sourceAnalyzed[index].intelligence?.newOccasionKeys || []
        const existingOccasions = item.existingOccasionKeys || []
        const occasionProjectionDifferences = [
          ...detected.filter(value => !existingOccasions.includes(value)).map(value => `Detected in source, not present on existing booking: ${value}`),
          ...existingOccasions.filter(value => !detected.includes(value)).map(value => `Present on existing booking, not detected in this source: ${value}`)
        ]
        return { ...item, source: sourceAnalyzed[index], existing: existingAnalyzed[index], occasionProjectionDifferences }
      })
      return send(response, 200, {
        batchId: input.batchId,
        rulesetVersion: sourceAnalyzed[0]?.intelligence?.rulesetVersion || 'booking-intelligence-r1.3.1',
        existingBookings: records.length,
        intelligenceFindings: sourceAnalyzed.reduce((total, booking) => total + (booking.intelligence?.findings.length || 0), 0),
        requiresIntelligenceReview: sourceAnalyzed.filter(booking => booking.intelligence?.reviewRequired).length,
        records
      }, { 'Cache-Control': 'no-store' })
    }
    if (request.method === 'POST' && url.pathname === '/api/bookings/validate-import-review') {
      assertTrustedOrigin(request)
      await authorizedBookingsContext(request)
      const input = await body(request) as { batchId?: string; index?: number; changes?: BookingImportReviewChanges }
      if (!input.batchId || !Number.isInteger(input.index) || !input.changes) return send(response, 400, { message: 'Import batch, review item and corrected values are required.' })
      return send(response, 200, await bookings.validateImportReview(input.batchId, input.index as number, input.changes))
    }
    if (request.method === 'POST' && url.pathname === '/api/bookings/confirm-import') {
      assertTrustedOrigin(request)
      const context = await authorizedBookingsContext(request)
      const input = await body(request) as { batchId?: string; selectedIndexes?: number[]; reviewDecisions?: BookingImportReviewDecision[] }
      if (!input.batchId || !Array.isArray(input.selectedIndexes)) return send(response, 400, { message: 'Import batch and selected bookings are required.' })
      const actor = auditActorLabel(context.principal)
      const result = await bookings.confirmImport(input.batchId, input.selectedIndexes, Array.isArray(input.reviewDecisions) ? input.reviewDecisions : [], actor, context.principal.userId, context.outlet.id)
      for (const bookingId of result.importedBookingIds) await occasions.detectForBooking(bookingId, context.outlet.id, actor)
      return send(response, 200, result)
    }
    const bookingGuestsMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)\/guest-members$/)
    if (request.method === 'GET' && bookingGuestsMatch) return send(response, 200, await bookings.guestMembers(bookingGuestsMatch[1]))
    if (request.method === 'GET' && url.pathname === '/api/config/training') { const configuration = await training.configuration(); return send(response, 200, { categories: configuration.categories, statuses: configuration.statuses, attendanceStatuses: configuration['attendance-statuses'], defaults: await training.defaults(), target: await training.target(), workflow: await training.workflow() }) }
    if (request.method === 'GET' && url.pathname === '/api/config/bookings') return send(response, 200, await bookings.configuration())
    if (request.method === 'GET' && url.pathname === '/api/config/chargeables') { await authorizedChargeableContext(request); return send(response, 200, { ...await chargeables.configuration(), wineCatalog: await wineSpirits.catalog() }) }
    if (request.method === 'GET' && url.pathname === '/api/config/guest-occasions') { await authorizedGuestOccasionsContext(request); return send(response, 200, await occasions.configuration()) }
    if (request.method === 'GET' && url.pathname === '/api/config/maintenance') { await authorizedMaintenanceContext(request); return send(response, 200, await maintenance.configuration()) }
    if (request.method === 'GET' && url.pathname === '/api/config/staff') return send(response, 200, await repository.configuration())
    if (request.method === 'GET' && url.pathname === '/api/workforce/leave-planner') { const context = await authorizedWorkforceContext(request); const month = url.searchParams.get('month') || serviceDate().slice(0, 7); return send(response, 200, await leavePlanner.view(month, context.outlet.scopeKey), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'POST' && url.pathname === '/api/workforce/leave-planner/ph-semantics') { assertTrustedOrigin(request); const context = await authorizedWorkforceContext(request); await authorization.requirePermission(context.principal, 'manage_platform'); if (!context.principal.isOwner) throw new AuthorizationError('FORBIDDEN', 'Owner authority is required for protected PH semantic correction.'); return send(response, 200, await repository.correctPublicHolidaySemantics(context.principal), { 'Cache-Control': 'no-store' }) }
    if (request.method === 'GET' && url.pathname === '/api/staff/leave-records') { await authorizedWorkforceContext(request); const start = url.searchParams.get('start') || `${serviceDate().slice(0, 4)}-01-01`; const end = url.searchParams.get('end') || `${serviceDate().slice(0, 4)}-12-31`; if (!validCalendarDate(start) || !validCalendarDate(end) || start > end) return send(response, 400, { message: 'Select a valid leave-record date range.' }); return send(response, 200, await repository.leaveRecords(start, end, url.searchParams.get('staffId') || undefined)) }
    if (request.method === 'GET' && url.pathname === '/api/workforce/staff-entitlements') { await authorizedWorkforceContext(request); return send(response, 200, await repository.entitlements()) }
    const entitlementBalanceMatch = url.pathname.match(/^\/api\/workforce\/staff-entitlements\/([^/]+)\/balance$/)
    if (request.method === 'GET' && entitlementBalanceMatch) { await authorizedWorkforceContext(request); const year = Number(url.searchParams.get('year') || serviceDate().slice(0, 4)); const weekDate = url.searchParams.get('weekDate') || serviceDate(); if (!validCalendarDate(weekDate)) return send(response, 400, { message: 'Select a valid week date.' }); const [weekStart, weekEnd] = weekRange(weekDate); return send(response, 200, await repository.entitlementBalance(entitlementBalanceMatch[1], year, weekStart, weekEnd)) }
    const entitlementMatch = url.pathname.match(/^\/api\/workforce\/staff-entitlements\/([^/]+)$/)
    if (request.method === 'PUT' && entitlementMatch) { const input = await body(request) as StaffEntitlement; return send(response, 200, await repository.saveEntitlement({ ...input, staffId: entitlementMatch[1] })) }
    if (request.method === 'GET' && url.pathname === '/api/workforce/public-holidays') return send(response, 200, await repository.publicHolidays(Number(url.searchParams.get('year') || serviceDate().slice(0, 4))))
    if (request.method === 'POST' && url.pathname === '/api/workforce/public-holidays') { const input = await body(request) as PublicHoliday; return send(response, 201, await repository.savePublicHoliday({ ...input, id: input.id || randomUUID() })) }
    const publicHolidayMatch = url.pathname.match(/^\/api\/workforce\/public-holidays\/([^/]+)$/)
    if (request.method === 'PUT' && publicHolidayMatch) { const input = await body(request) as PublicHoliday; return send(response, 200, await repository.savePublicHoliday({ ...input, id: publicHolidayMatch[1] })) }
    if (request.method === 'DELETE' && publicHolidayMatch) { await repository.removePublicHoliday(publicHolidayMatch[1]); return send(response, 204, {}) }
    if (request.method === 'GET' && url.pathname === '/api/roster') return send(response, 200, await operations.roster(url.searchParams.get('start') || serviceDate(), url.searchParams.get('end') || serviceDate()))
    if (request.method === 'GET' && url.pathname === '/api/attendance') return send(response, 200, await operations.attendance(url.searchParams.get('start') || serviceDate(), url.searchParams.get('end') || serviceDate()))
    if (request.method === 'GET' && url.pathname === '/api/config/attendance-statuses') return send(response, 200, await operations.statuses())
    if (request.method === 'POST' && url.pathname === '/api/config/attendance-statuses') { const input = await body(request) as ConfigOption; if (!input.value?.trim() || !input.label?.trim()) return send(response, 400, { message: 'Status code and name are required.' }); return send(response, 201, await operations.saveStatus({ ...input, id: input.id || randomUUID() })) }
    const statusMatch = url.pathname.match(/^\/api\/config\/attendance-statuses\/([^/]+)$/)
    if (request.method === 'PUT' && statusMatch) { const input = await body(request) as ConfigOption; if (!input.value?.trim() || !input.label?.trim()) return send(response, 400, { message: 'Status code and name are required.' }); return send(response, 200, await operations.saveStatus({ ...input, id: statusMatch[1] })) }
    if (request.method === 'POST' && url.pathname === '/api/config/training/categories/reorder') { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const input = await body(request) as { id?: string; direction?: 'up' | 'down' }; if (!input.id || !['up','down'].includes(input.direction || '')) return send(response, 400, { message: 'Select a Training category and direction.' }); return send(response, 200, await training.reorderCategory(input.id, input.direction!, auditActorLabel(context.principal))) }
    if (request.method === 'PUT' && url.pathname === '/api/config/training/categories/order') { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const input = await body(request) as { orderedIds?: string[] }; if (!Array.isArray(input.orderedIds)) return send(response, 400, { message: 'Training category order is required.' }); return send(response, 200, await training.reorderCategories(input.orderedIds, auditActorLabel(context.principal))) }
    const trainingCategoryMatch = url.pathname.match(/^\/api\/config\/training\/categories\/([^/]+)$/)
    if (request.method === 'PUT' && trainingCategoryMatch) { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const input = await body(request) as ConfigOption; return send(response, 200, await training.saveCategory({ ...input, id: trainingCategoryMatch[1] }, auditActorLabel(context.principal))) }
    if (request.method === 'PUT' && url.pathname === '/api/config/training/defaults') { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const input = await body(request) as TrainingDefaults; return send(response, 200, await training.saveDefaults(input, auditActorLabel(context.principal))) }
    if (request.method === 'POST' && url.pathname === '/api/config/training/targets') { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); await authorization.requireOutletPermission(context.principal, 'manage_reports', context.outlet.id); await authorization.requirePermission(context.principal, 'manage_platform'); if (!context.principal.isOwner) throw new AuthorizationError('FORBIDDEN', 'Owner authority is required for Training target policy changes.'); const input = await body(request) as { effectiveMonth: string; monthlyTargetHours: number; perHeadTargetHours: number }; return send(response, 201, await training.createTargetVersion(input, context.principal)) }
    const trainingWorkflowMatch = url.pathname.match(/^\/api\/config\/training\/workflow\/(scheduled|awaiting_confirmation|completed|cancelled)$/)
    if (request.method === 'PUT' && trainingWorkflowMatch) { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const input = await body(request) as { color?: string }; return send(response, 200, await training.saveWorkflowColor(trainingWorkflowMatch[1] as TrainingOperationalStatus, String(input.color || ''), auditActorLabel(context.principal))) }
    const bookingConfigMatch = url.pathname.match(/^\/api\/config\/bookings\/(statuses|sources|tables|table-ranges|walk-in-fields)\/([^/]+)$/)
    if (request.method === 'PUT' && bookingConfigMatch) { assertTrustedOrigin(request); const context = await authorizedBookingsContext(request); const input = await body(request) as ConfigOption; if (!input.value?.trim() || !input.label?.trim()) return send(response, 400, { message: 'Configuration code and label are required.' }); const group = bookingConfigMatch[1] === 'table-ranges' ? 'tableRanges' : bookingConfigMatch[1] === 'walk-in-fields' ? 'walkInFields' : bookingConfigMatch[1] as BookingConfigGroup; return send(response, 200, await bookings.saveConfiguration(group, { ...input, id: bookingConfigMatch[2] }, auditActorLabel(context.principal))) }
    if (request.method === 'POST' && url.pathname === '/api/config/bookings/walk-in-fields/reset') { assertTrustedOrigin(request); const context = await authorizedBookingsContext(request); return send(response, 200, await bookings.resetWalkInFields(auditActorLabel(context.principal))) }
    const chargeableConfigMatch = url.pathname.match(/^\/api\/config\/chargeables\/(items|statuses)\/([^/]+)$/)
    if (request.method === 'PUT' && chargeableConfigMatch) { assertTrustedOrigin(request); const context = await authorizedChargeableContext(request); const input = await body(request) as ConfigOption; if (!input.value?.trim() || !input.label?.trim()) return send(response, 400, { message: 'Configuration code and label are required.' }); if (chargeableConfigMatch[1] === 'items' && (!Number.isFinite(Number(input.metadata?.price)) || Number(input.metadata?.price) < 0 || !input.metadata?.category?.trim())) return send(response, 400, { message: 'Item category and a valid non-negative price are required.' }); return send(response, 200, await chargeables.saveConfiguration(chargeableConfigMatch[1] as ChargeableConfigGroup, { ...input, id: chargeableConfigMatch[2] }, { outletScopeId: context.outlet.id, actor: auditActorLabel(context.principal) })) }
    const wineCatalogMatch = url.pathname.match(/^\/api\/config\/chargeables\/wine-catalog\/([^/]+)$/)
    if (request.method === 'PUT' && wineCatalogMatch) { assertTrustedOrigin(request); const context = await authorizedWineSpiritsContext(request); const input = await body(request) as ConfigOption; return send(response, 200, await wineSpirits.saveCatalog({ ...input, id: wineCatalogMatch[1] }, { outletScopeId: context.outlet.id, actor: context.principal })) }
    const occasionConfigMatch = url.pathname.match(/^\/api\/config\/guest-occasions\/(types|statuses)\/([^/]+)$/)
    if (request.method === 'PUT' && occasionConfigMatch) { assertTrustedOrigin(request); const context = await authorizedGuestOccasionsContext(request); const input = await body(request) as ConfigOption; if (!input.label?.trim() || (occasionConfigMatch[1] === 'statuses' && !input.value?.trim())) return send(response, 400, { message: 'Configuration name is required.' }); return send(response, 200, await occasions.saveConfiguration(occasionConfigMatch[1] as GuestOccasionConfigGroup, { ...input, id: occasionConfigMatch[2] }, auditActorLabel(context.principal))) }
    const maintenanceConfigMatch = url.pathname.match(/^\/api\/config\/maintenance\/(areas|statuses)\/([^/]+)$/)
    if (request.method === 'PUT' && maintenanceConfigMatch) { assertTrustedOrigin(request); const context = await authorizedMaintenanceContext(request); const input = await body(request) as ConfigOption; if (!input.label?.trim()) return send(response, 400, { message: 'Configuration name is required.' }); return send(response, 200, await maintenance.saveConfiguration(maintenanceConfigMatch[1] as MaintenanceConfigGroup, { ...input, id: maintenanceConfigMatch[2] }, context.principal)) }
    if (request.method === 'POST' && url.pathname === '/api/config/staff/duty-codes/reorder') { const input = await body(request) as { id?: string; direction?: string }; if (!input.id || (input.direction !== 'up' && input.direction !== 'down')) return send(response, 400, { message: 'Select a duty code and direction.' }); return send(response, 200, await repository.reorderDutyCode(input.id, input.direction)) }
    const staffConfigMatch = url.pathname.match(/^\/api\/config\/staff\/(duty-codes|employment-statuses|positions)\/([^/]+)$/)
    if (request.method === 'PUT' && staffConfigMatch) { const input = await body(request) as ConfigOption; if (!input.label?.trim() || (staffConfigMatch[1] !== 'duty-codes' && !input.value?.trim())) return send(response, 400, { message: 'Configuration code and name are required.' }); return send(response, 200, await repository.saveConfiguration(staffConfigMatch[1] as StaffConfigGroup, { ...input, id: staffConfigMatch[2] })) }
    if (request.method === 'DELETE' && staffConfigMatch && staffConfigMatch[1] === 'duty-codes') return send(response, 200, await repository.removeDutyCode(staffConfigMatch[2]))
    const staffHistoryMatch = url.pathname.match(/^\/api\/staff\/([^/]+)\/training-history$/)
    if (request.method === 'GET' && staffHistoryMatch) return send(response, 200, await training.staffHistory(staffHistoryMatch[1]))
    const match = url.pathname.match(/^\/api\/staff\/([^/]+)$/)
    if (request.method === 'POST' && url.pathname === '/api/staff') { const input = await body(request) as Staff; const message = valid(input); if (message) return send(response, 400, { message }); return send(response, 201, await repository.create(input)) }
    if (request.method === 'PUT' && match) { const input = await body(request) as Staff; const message = valid({ ...input, id: match[1] }); if (message) return send(response, 400, { message }); const updated = await repository.update(match[1], { ...input, id: match[1] }); return updated ? send(response, 200, updated) : send(response, 404, { message: 'Staff member not found.' }) }
    const rosterMatch = url.pathname.match(/^\/api\/roster\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/)
    if (request.method === 'PUT' && rosterMatch) { const input = await body(request) as { dutyCode?: unknown }; if (typeof input.dutyCode !== 'string') return send(response, 400, { message: 'Duty code is required.' }); await operations.updateRoster(rosterMatch[1], rosterMatch[2], input.dutyCode); return send(response, 204, {}) }
    const attendanceMatch = url.pathname.match(/^\/api\/attendance\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/)
    if (request.method === 'PUT' && attendanceMatch) { const input = await body(request) as AttendanceRecord; if (!input.attendanceStatus) return send(response, 400, { message: 'Attendance status is required.' }); await operations.saveAttendance({ ...input, staffId: attendanceMatch[1], date: attendanceMatch[2] }); return send(response, 204, {}) }
    if (request.method === 'POST' && url.pathname === '/api/training') { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const input = await body(request) as TrainingSession; if (!input.id || !input.title?.trim() || !input.category || !input.date || !(input.startTime || input.time) || !input.trainer?.trim() || !input.status) return send(response, 400, { message: 'Title, category, date, time, trainer and status are required.' }); return send(response, 201, await training.save({ ...input, active: true, source: input.source || 'manual' }, auditActorLabel(context.principal))) }
    const trainingAttendanceMatch = url.pathname.match(/^\/api\/training\/([^/]+)\/attendance$/)
    if (request.method === 'PUT' && trainingAttendanceMatch) { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const input = await body(request) as { attendance: Array<{ staffId: string; attendanceStatus: string | null }> }; return send(response, 200, await training.saveAttendance(trainingAttendanceMatch[1], input.attendance || [], auditActorLabel(context.principal))) }
    const trainingDetailMatch = url.pathname.match(/^\/api\/training\/([^/]+)\/r2-detail$/)
    if (request.method === 'GET' && trainingDetailMatch) { await authorizedTrainingContext(request); return send(response, 200, await trainingR2.detail(trainingDetailMatch[1]), { 'Cache-Control': 'no-store' }) }
    const trainingConfirmMatch = url.pathname.match(/^\/api\/training\/([^/]+)\/confirm$/)
    if (request.method === 'POST' && trainingConfirmMatch) { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const input = await body(request) as TrainingCompletionInput; return send(response, 200, await trainingR2.confirm(trainingConfirmMatch[1], input, context.principal), { 'Cache-Control': 'no-store' }) }
    const trainingMatch = url.pathname.match(/^\/api\/training\/([^/]+)$/)
    if (request.method === 'PUT' && trainingMatch) { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); const input = await body(request) as TrainingSession; if (!input.title?.trim() || !input.category || !input.date || !(input.startTime || input.time) || !input.trainer?.trim() || !input.status) return send(response, 400, { message: 'Title, category, date, time, trainer and status are required.' }); return send(response, 200, await training.save({ ...input, id: trainingMatch[1] }, auditActorLabel(context.principal))) }
    if (request.method === 'DELETE' && trainingMatch) { assertTrustedOrigin(request); const context = await authorizedTrainingContext(request); return send(response, 200, await training.archive(trainingMatch[1], auditActorLabel(context.principal))) }
    if (request.method === 'POST' && url.pathname === '/api/bookings/walk-in') { assertTrustedOrigin(request); const context = await authorizedBookingsContext(request); const input = await body(request) as WalkInBookingInput; if (!input.id) return send(response, 400, { message: 'Walk-in booking identity is required.' }); await bookings.validateWalkIn(input); const configured = await bookings.configuration(); const confirmed = configured.statuses.find(option => option.value === 'confirmed' && option.active); if (!confirmed) return send(response, 409, { message: 'The safe Confirmed booking status is unavailable.' }); const fieldMode = (field: string) => configured.walkInFields.find(option => option.value === field)?.metadata?.walkInFieldMode; const hidden = (field: string) => fieldMode(field) === 'hidden'; const record: BookingRecord = { id: input.id, guestName: hidden('guestName') ? '' : String(input.guestName ?? '').trim(), roomNumber: hidden('roomNumber') ? '' : String(input.roomNumber ?? '').trim(), birthDate: hidden('birthDate') ? null : input.birthDate || null, arrivalDate: hidden('arrivalDate') ? null : input.arrivalDate || null, departureDate: hidden('departureDate') ? null : input.departureDate || null, mealPeriod: String(input.mealPeriod ?? '').trim(), reservationDate: input.reservationDate, reservationTime: input.reservationTime, bookingNumber: '', covers: Number(input.covers), bookingStatus: confirmed.value, bookingSource: 'walk_in', bookedBy: context.principal.displayName, guestNotes: hidden('guestNotes') ? '' : String(input.guestNotes ?? '').trim(), tableNumber: hidden('tableNumber') ? '' : String(input.tableNumber ?? ''), waiterId: hidden('waiterId') ? null : input.waiterId || null, waiter: null, importSource: 'walk_in' }; const actor = auditActorLabel(context.principal); const saved = await bookings.save(record, actor); await occasions.detectForBooking(saved.id, context.outlet.id, actor); return send(response, 201, saved) }
    if (request.method === 'POST' && url.pathname === '/api/bookings') { assertTrustedOrigin(request); const context = await authorizedBookingsContext(request); const input = await body(request) as BookingRecord; if (!input.id || !input.guestName?.trim() || !input.reservationDate || !input.reservationTime || !Number.isInteger(input.covers) || input.covers < 1 || !input.bookingStatus || !input.bookingSource) return send(response, 400, { message: 'Guest name, reservation date, time, covers, status and source are required.' }); const actor = auditActorLabel(context.principal); const saved = await bookings.save(input, actor); await occasions.detectForBooking(saved.id, context.outlet.id, actor); return send(response, 201, saved) }
    const bookingMatch = url.pathname.match(/^\/api\/bookings\/([^/]+)$/)
    if (request.method === 'PUT' && bookingMatch) { assertTrustedOrigin(request); const context = await authorizedBookingsContext(request); const input = await body(request) as BookingRecord; const previous = await bookings.find(bookingMatch[1]); if (!previous) return send(response, 404, { message: 'Booking not found.' }); const walkIn = previous.bookingSource === 'walk_in'; if (walkIn) await bookings.validateWalkIn(input); else if (!input.guestName?.trim() || !input.reservationDate || !input.reservationTime || !Number.isInteger(input.covers) || input.covers < 1 || !input.bookingStatus || !input.bookingSource) return send(response, 400, { message: 'Guest name, reservation date, time, covers, status and source are required.' }); const actor = auditActorLabel(context.principal); const saved = await bookings.save({ ...input, id: bookingMatch[1], bookingSource: walkIn ? 'walk_in' : input.bookingSource, bookedBy: walkIn ? previous.bookedBy : input.bookedBy, importSource: walkIn ? 'walk_in' : input.importSource }, actor); await occasions.detectForBooking(saved.id, context.outlet.id, actor); return send(response, 200, saved) }
    if (request.method === 'POST' && url.pathname === '/api/chargeables/duplicate-review') { assertTrustedOrigin(request); const context = await authorizedChargeableContext(request); const input = await body(request) as ChargeableWriteRequest; return send(response, 200, await chargeables.duplicateWarnings(input, context.outlet.id)) }
    if (request.method === 'POST' && url.pathname === '/api/chargeables') { assertTrustedOrigin(request); const context = await authorizedChargeableContext(request); const input = await body(request) as ChargeableWriteRequest; if (!input.id || !input.date || !input.guestName?.trim() || !input.itemValue || !Number.isInteger(Number(input.quantity)) || Number(input.quantity) < 1 || !input.status) return send(response, 400, { message: 'Date, guest, item, quantity and status are required.' }); return send(response, 201, await createChargeableRecord(input, context.outlet.id, auditActorLabel(context.principal))) }
    const chargeableMatch = url.pathname.match(/^\/api\/chargeables\/([^/]+)$/)
    if (request.method === 'PUT' && chargeableMatch) { assertTrustedOrigin(request); const context = await authorizedChargeableContext(request); const input = await body(request) as ChargeableWriteRequest; if (!input.date || !input.guestName?.trim() || !input.itemValue || !Number.isInteger(Number(input.quantity)) || Number(input.quantity) < 1 || !input.status) return send(response, 400, { message: 'Date, guest, item, quantity and status are required.' }); return send(response, 200, await saveChargeableRecord({ ...input, id: chargeableMatch[1] }, context.outlet.id, auditActorLabel(context.principal))) }
    if (request.method === 'DELETE' && chargeableMatch) { assertTrustedOrigin(request); const context = await authorizedChargeableContext(request); return send(response, 200, await chargeables.archive(chargeableMatch[1], { outletScopeId: context.outlet.id, actor: auditActorLabel(context.principal) })) }
    if (request.method === 'POST' && url.pathname === '/api/guest-occasions') { assertTrustedOrigin(request); const context = await authorizedGuestOccasionsContext(request); const input = await body(request) as GuestOccasionRecord; if (!input.id || !input.occasionType || !input.guestName?.trim() || !input.reservationDate || !input.reservationTime || !input.status) return send(response, 400, { message: 'Occasion type, guest, date, time and status are required.' }); return send(response, 201, await occasions.save(input, auditActorLabel(context.principal), context.outlet.scopeKey)) }
    const occasionDetectMatch = url.pathname.match(/^\/api\/guest-occasions\/detect\/([^/]+)$/)
    if (request.method === 'POST' && occasionDetectMatch) { assertTrustedOrigin(request); const context = await authorizedGuestOccasionsContext(request); return send(response, 200, await occasions.detectForBooking(occasionDetectMatch[1], context.outlet.id, auditActorLabel(context.principal))) }
    const occasionCorrectionMatch = url.pathname.match(/^\/api\/guest-experience\/findings\/([^/]+)\/correct$/)
    if (request.method === 'POST' && occasionCorrectionMatch) { assertTrustedOrigin(request); const context = await authorizedGuestOccasionsContext(request); const input = await body(request) as { effectiveClassification?: string; reason?: string }; if (!input.effectiveClassification?.trim() || !input.reason?.trim()) return send(response, 400, { message: 'Effective classification and correction reason are required.' }); return send(response, 200, await occasions.correctFinding(occasionCorrectionMatch[1], input.effectiveClassification.trim(), input.reason.trim(), context.principal, context.outlet.id)) }
    const occasionMatch = url.pathname.match(/^\/api\/guest-occasions\/([^/]+)$/)
    if (request.method === 'PUT' && occasionMatch) { assertTrustedOrigin(request); const context = await authorizedGuestOccasionsContext(request); const input = await body(request) as GuestOccasionRecord; if (!input.occasionType || !input.guestName?.trim() || !input.reservationDate || !input.reservationTime || !input.status) return send(response, 400, { message: 'Occasion type, guest, date, time and status are required.' }); return send(response, 200, await occasions.save({ ...input, id: occasionMatch[1] }, auditActorLabel(context.principal), context.outlet.scopeKey)) }
    if (request.method === 'POST' && url.pathname === '/api/maintenance/duplicate-review') { assertTrustedOrigin(request); const context = await authorizedMaintenanceContext(request); const input = await body(request) as MaintenanceRecord; return send(response, 200, await maintenance.duplicateWarnings(input, context.outlet.id)) }
    if (request.method === 'POST' && url.pathname === '/api/maintenance') { assertTrustedOrigin(request); const context = await authorizedMaintenanceContext(request); const input = await body(request) as MaintenanceRecord; if (!input.id || !input.issue?.trim() || !input.dateReported || !input.area || !input.status || !input.priority) return send(response, 400, { message: 'Issue, date reported, area, priority and status are required.' }); return send(response, 201, await maintenance.save(input, { outletScopeId: context.outlet.id, actor: context.principal })) }
    const maintenanceMatch = url.pathname.match(/^\/api\/maintenance\/([^/]+)$/)
    if (request.method === 'PUT' && maintenanceMatch) { assertTrustedOrigin(request); const context = await authorizedMaintenanceContext(request); const input = await body(request) as MaintenanceRecord; if (!input.issue?.trim() || !input.dateReported || !input.area || !input.status || !input.priority) return send(response, 400, { message: 'Issue, date reported, area, priority and status are required.' }); return send(response, 200, await maintenance.save({ ...input, id: maintenanceMatch[1] }, { outletScopeId: context.outlet.id, actor: context.principal })) }
    if (request.method === 'PUT' && url.pathname === '/api/reports/manager-summary') { const input = await body(request) as ReportManagerSummary; if (!input.periodType || !input.startDate || !input.endDate) return send(response, 400, { message: 'Report period is required.' }); return send(response, 200, await reporting.saveManagerSummary(input)) }
    return send(response, 404, { message: 'Not found.' })
  } catch (error) { if (error instanceof AuthError || error instanceof AuthorizationError) return send(response, error.status, { code: error.code, message: error.message }, { 'Cache-Control': 'no-store' }); const expectedStatus = expectedErrorStatus(error); if (!expectedStatus) console.error(error); return send(response, expectedStatus || 500, { message: error instanceof Error ? error.message : 'Unexpected server error.' }) }
})

server.listen(Number(process.env.API_PORT || 3001), '127.0.0.1', () => console.log(`Operations API listening on http://127.0.0.1:${process.env.API_PORT || 3001}`))
let shutdownStarted = false
const gracefulShutdown = async (signal: string) => {
  if (shutdownStarted) return
  shutdownStarted = true
  console.log(`Database-safe shutdown started (${signal}).`)
  await new Promise<void>((resolveShutdown, rejectShutdown) => server.close(error => error ? rejectShutdown(error) : resolveShutdown()))
  await repository.close()
  console.log('Database-safe shutdown completed.')
}
startSchedulerShutdownControl({ backupRoot: defaultBackupRoot, gracefulShutdown })
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { gracefulShutdown(signal).then(() => { process.exitCode = 0 }).catch(error => { console.error('Database-safe shutdown failed.', error); process.exitCode = 1 }) })

async function authorizeBaselineReview(request: import('node:http').IncomingMessage, reviewId: string, permission: AuthorizationPermissionKey) {
  const principal = await requireAuthenticatedUser(request, auth)
  const outletScopeId = await membershipBaseline.reviewOutletScopeId(reviewId)
  if (!outletScopeId) throw new Error('Baseline review not found.')
  return authorization.requireOutletPermission(principal, permission, outletScopeId)
}

async function authorizedChargeableContext(request: import('node:http').IncomingMessage) {
  const principal = await requireAuthenticatedUser(request, auth)
  const outlet = await outletMembership.findOutletByKey('andalucia')
  if (!outlet?.active) throw new Error('The operational Chargeable Item outlet is unavailable.')
  await authorization.requireOutletPermission(principal, 'manage_chargeables', outlet.id)
  return { principal, outlet }
}

async function authorizedBookingsContext(request: import('node:http').IncomingMessage) {
  const principal = await requireAuthenticatedUser(request, auth)
  const outlet = await outletMembership.findOutletByKey('andalucia')
  if (!outlet?.active) throw new Error('The Andalucía Bookings outlet is unavailable.')
  await authorization.requireOutletPermission(principal, 'manage_bookings', outlet.id)
  return { principal, outlet }
}

async function authorizedGuestOccasionsContext(request: import('node:http').IncomingMessage) {
  const principal = await requireAuthenticatedUser(request, auth)
  const outlet = await outletMembership.findOutletByKey('andalucia')
  if (!outlet?.active) throw new Error('The Andalucía Guest Experience outlet is unavailable.')
  await authorization.requireOutletPermission(principal, 'manage_guest_occasions', outlet.id)
  return { principal, outlet }
}

async function authorizedTrainingContext(request: import('node:http').IncomingMessage) {
  const principal = await requireAuthenticatedUser(request, auth)
  const outlet = await outletMembership.findOutletByKey('andalucia')
  if (!outlet?.active) throw new Error('The Andalucía Training outlet is unavailable.')
  await authorization.requireOutletPermission(principal, 'manage_training', outlet.id)
  return { principal, outlet }
}

async function authorizedWorkforceContext(request: import('node:http').IncomingMessage) {
  const principal = await requireAuthenticatedUser(request, auth)
  const outlet = await outletMembership.findOutletByKey('andalucia')
  if (!outlet?.active) throw new Error('The Andalucía Workforce outlet is unavailable.')
  await authorization.requireOutletPermission(principal, 'manage_duty_roster', outlet.id)
  return { principal, outlet }
}

async function authorizedMaintenanceContext(request: import('node:http').IncomingMessage) {
  const principal = await requireAuthenticatedUser(request, auth)
  const outlet = await outletMembership.findOutletByKey('andalucia')
  if (!outlet?.active) throw new Error('The Andalucía Maintenance outlet is unavailable.')
  await authorization.requireOutletPermission(principal, 'manage_maintenance', outlet.id)
  return { principal, outlet }
}

async function authorizedWineSpiritsContext(request: import('node:http').IncomingMessage) {
  const principal = await requireAuthenticatedUser(request, auth)
  const outlet = await outletMembership.findOutletByKey('andalucia')
  if (!outlet?.active) throw new Error('The Andalucía Wine/Spirits outlet is unavailable.')
  await authorization.requireOutletPermission(principal, 'manage_chargeables', outlet.id)
  await authorization.requireOutletPermission(principal, 'manage_incentives', outlet.id)
  return { principal, outlet }
}

async function authorizedReportsContext(request: import('node:http').IncomingMessage) {
  const principal = await requireAuthenticatedUser(request, auth)
  const outlet = await outletMembership.findOutletByKey('andalucia')
  if (!outlet?.active) throw new Error('The Andalucía Reports outlet is unavailable.')
  await authorization.requireOutletPermission(principal, 'manage_reports', outlet.id)
  return { principal, outlet }
}

async function authorizedBillTipOutlet(principal: Awaited<ReturnType<typeof requireAuthenticatedUser>>, permission: AuthorizationPermissionKey) {
  const outlet = await outletMembership.findOutletByKey('andalucia')
  if (!outlet?.active) throw new Error('The Andalucía Bill Tip outlet is unavailable.')
  await authorization.requireOutletPermission(principal, permission, outlet.id)
  return outlet
}

async function saveChargeableRecord(record: ChargeableWriteRequest, outletScopeId: string, actor: string) {
  try { return await chargeables.save(record, { outletScopeId, actor }) }
  catch (error) {
    if (typeof (error as { code?: unknown })?.code === 'string') {
      console.error('Chargeable Item persistence failure', error)
      throw new Error('The Chargeable Item could not be saved. Please try again or contact the system administrator.')
    }
    throw error
  }
}

async function createChargeableRecord(record: ChargeableWriteRequest, outletScopeId: string, actor: string) {
  try { return await chargeables.create(record, { outletScopeId, actor }) }
  catch (error) {
    if (typeof (error as { code?: unknown })?.code === 'string') {
      console.error('Chargeable Item persistence failure', error)
      throw new Error('The Chargeable Item could not be saved. Please try again or contact the system administrator.')
    }
    throw error
  }
}
