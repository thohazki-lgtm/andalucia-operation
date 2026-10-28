import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { bookingApi, chargeableApi, guestOccasionApi, maintenanceApi, operationsApi, reportingApi, staffApi, trainingApi } from './api'
import { LEAVE_CLASSIFICATION_LABELS, config, coreDutyCode, isLeaveClassification, type AttendanceRecord, type BookingRecord, type ConfigOption, type MaintenanceRecord, type OperationalReport, type RosterBatchChange, type RosterEntry, type Staff, type TrainingCustomization, type TrainingSession } from './domain'
import { StaffTrainingHistoryPanel, TrainingConfigurationManager } from './training'
import { TrainingR2Page as TrainingPage } from './training-r2'
import { BookingConfigurationManager, BookingsPage } from './bookings'
import { ChargeableConfigurationManager } from './chargeables'
import { IncentivesBillTipsPage } from './financial-preview'
import { GuestOccasionConfigurationManager, GuestOccasionsPage } from './guest-occasions'
import { MaintenanceConfigurationManager, MaintenancePage } from './maintenance'
import { ReportsPage } from './reports'
import { EntitlementPoliciesPanel, LeaveTypesPanel, PublicHolidaySettingsManager, StaffEntitlementsManager } from './workforce'
import { addCalendarDays, addCalendarMonths, calendarDates, monthRange, rosterWeekRange, serviceDate, serviceTime, weekRange } from './service-date'
import { requestWorkflow } from './workflow-intent'
import { StaffLeaveAvailability } from './staff-leave'
import { LeavePlannerPanel } from './leave-planner'
import { buildDailyTraining, buildDashboardData, buildHostessServiceBoard, buildTeamToday, dashboardOccasionStyle } from './dashboard-data'
import { StaffMembershipBaselinePanel } from './staff-membership-baseline'
import { AuthUserButton, useAuth } from './auth'
import { DatabaseHealthPanel } from './database-health'
import { moveDutyCode, type DutyCodeDropPlacement } from './duty-code-order'
import { StaffAccountManagement } from './staff-account-management'
import { MyTimesheetPage } from './my-timesheet'
import { ManagerTimesheets } from './manager-timesheets'
import { designationLabel, staffDirectorySearchText } from './staff-directory-view'
import { shareOrDownloadRosterPdf } from './roster-pdf'
import { approvedDutyFinancialRule } from './duty-financial-policy'
import { ActionButton, DateControl, IconAction, StatusPill, SvgIcon } from './action-system'
import { BrandWordmark } from './brand'

const navigation = [
 { label: 'Dashboard', icon: '⌂', eyebrow: 'OPERATIONS OVERVIEW' },
 { label: 'Staff Management', icon: '♙', eyebrow: 'TEAM DIRECTORY' },
 { label: 'Duty Roster', icon: '▦', eyebrow: 'WORKFORCE PLANNING' },
 { label: 'Leave Planner', icon: '◇', eyebrow: 'LEAVE & ENTITLEMENTS' },
 { label: 'Training', icon: '✦', eyebrow: 'PEOPLE DEVELOPMENT' },
 { label: 'Bookings', icon: '▤', eyebrow: 'RESTAURANT RESERVATIONS' },
 { label: 'Guest Occasions', icon: '♡', eyebrow: 'GUEST EXPERIENCE' },
 { label: 'Incentives & Bill Tips', icon: '$', eyebrow: 'SERVICE REVENUE' },
 { label: 'Maintenance', icon: '⚒', eyebrow: 'OPERATIONS SUPPORT' },
 { label: 'Reports', icon: '▥', eyebrow: 'MANAGEMENT REPORTING' },
 { label: 'Customization Center', icon: '⚙', eyebrow: 'SYSTEM CONFIGURATION' }
] as const
const employeeNavigation = [{ label: 'My Timesheet', icon: '◷', eyebrow: 'EMPLOYEE SELF SERVICE' }] as const
const moduleThemeClass = (page: string) => `module-${page.toLowerCase().replaceAll('&', 'and').replaceAll(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
const dutyDisplayCode = (option?: ConfigOption) => option?.metadata?.displayCode?.trim() || option?.value || ''
const isLegacySickLeave = (option?: ConfigOption) => dutyDisplayCode(option).toUpperCase() === 'SK'
const dutyFinancialRuleView = (option: ConfigOption) => {
 const approvedRule = approvedDutyFinancialRule(option); const storedEligible = option.metadata?.billTipEligible; const units = approvedRule?.workedDayUnits ?? option.metadata?.billTipWorkedDayUnits; const eligible = approvedRule?.billTipEligible ?? (storedEligible === false || storedEligible === true && (units === 0 || units === 1) ? storedEligible : undefined)
 return { eligible, units, label: typeof eligible !== 'boolean' ? 'Decision required' : eligible === false ? 'Not eligible · 0 days' : `Eligible · ${units} day${units === 1 ? '' : 's'}` }
}
const readableDutyText = (color?: string) => { const match = /^#([0-9a-f]{6})$/i.exec(color || ''); if (!match) return '#ffffff'; const value = Number.parseInt(match[1], 16); const red = value >> 16; const green = value >> 8 & 255; const blue = value & 255; return (red * 299 + green * 587 + blue * 114) / 1000 >= 150 ? '#173247' : '#ffffff' }
function App() {
 const { user } = useAuth()
 const employeeMode = user.roleKeys.includes('employee_self_service') && !user.isOwner && !user.permissionKeys.includes('manage_staff')
 const visibleNavigation = employeeMode ? employeeNavigation : navigation
 const [reportBooking, setReportBooking] = useState<{ id: string; date: string } | null>(null)
 const [trainingCustomization, setTrainingCustomization] = useState<TrainingCustomization>({ defaults: { durationMinutes: 30, trainerMode: 'venue_manager', trainerStaffId: null, location: 'Andalucía', categoryValue: null, participantSelection: 'eligible_staff' }, target: { id: '', versionNumber: 1, effectiveMonth: '2026-09-01', monthlyTargetMinutes: 3600, monthlyTargetHours: 60, perHeadTargetMinutes: 216, perHeadTargetHours: 3.6, participantCreditCapMinutes: 30, calculationPolicyVersion: 'training-credit-v1', approvedBy: '', approvedAt: '' }, workflow: [{ state: 'scheduled', label: 'Scheduled', color: '#2f8063', protected: true }, { state: 'awaiting_confirmation', label: 'Awaiting Confirmation', color: '#b38b3a', protected: true }, { state: 'completed', label: 'Completed', color: '#1b6288', protected: true }, { state: 'cancelled', label: 'Cancelled', color: '#a7b0ba', protected: true }] })
 const [page, setPage] = useState(employeeMode ? 'My Timesheet' : 'Dashboard'); const [configuration, setConfiguration] = useState(config); const [staff, setStaff] = useState<Staff[]>([]); const [staffLoading, setStaffLoading] = useState(true); const [staffError, setStaffError] = useState(''); const [toast, setToast] = useState(''); const [showStaff, setShowStaff] = useState(false); const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false); const [reportHeaderDate, setReportHeaderDate] = useState(formatDate(serviceDate())); const [rosterUnsaved, setRosterUnsaved] = useState(false); const [reportsUnsaved, setReportsUnsaved] = useState(false); const [maintenanceTargetId, setMaintenanceTargetId] = useState<string | null>(null); const [staffPageContext, setStaffPageContext] = useState('TEAM DIRECTORY'); const [leavePlannerTarget, setLeavePlannerTarget] = useState<{ view: 'planner' | 'history'; staffId?: string } | null>(null)
 const loadStaff = async () => { if (employeeMode) return; setStaffLoading(true); setStaffError(''); try { setStaff(await staffApi.list()) } catch (error) { setStaffError(error instanceof Error ? error.message : 'Unable to load staff records.') } finally { setStaffLoading(false) } }
 useEffect(() => { if (employeeMode) return; void loadStaff(); void operationsApi.attendanceStatuses().then(statuses => setConfiguration(current => ({ ...current, attendanceStatuses: statuses }))).catch(() => setToast('Unable to load attendance statuses.')); void staffApi.configuration().then(staffConfiguration => setConfiguration(current => ({ ...current, ...staffConfiguration }))).catch(() => setToast('Unable to load staff configuration.')) }, [employeeMode])
 const applyTrainingConfiguration = (training: Awaited<ReturnType<typeof trainingApi.configuration>>) => { setConfiguration(current => ({ ...current, trainingCategories: training.categories, trainingStatuses: training.statuses, trainingAttendanceStatuses: training.attendanceStatuses })); setTrainingCustomization(current => ({ defaults: training.defaults || current.defaults, target: training.target || current.target, workflow: training.workflow || current.workflow })) }
 useEffect(() => { if (employeeMode) return; void trainingApi.configuration().then(applyTrainingConfiguration).catch(() => setToast('Unable to load training configuration.')) }, [employeeMode])
 useEffect(() => { if (employeeMode) return; void bookingApi.configuration().then(booking => setConfiguration(current => ({ ...current, bookingStatuses: booking.statuses, bookingSources: booking.sources, restaurantTables: booking.tables, restaurantTableRanges: booking.tableRanges, bookingWalkInFields: booking.walkInFields }))).catch(() => setToast('Unable to load booking configuration.')) }, [employeeMode])
 useEffect(() => { if (employeeMode) return; void chargeableApi.configuration().then(chargeable => setConfiguration(current => ({ ...current, chargeableItems: chargeable.items, chargeableStatuses: chargeable.statuses, wineSpiritCatalog: chargeable.wineCatalog ?? [] }))).catch(() => setToast('Unable to load chargeable configuration.')) }, [employeeMode])
 useEffect(() => { if (employeeMode) return; void guestOccasionApi.configuration().then(occasion => setConfiguration(current => ({ ...current, occasionTypes: occasion.types, occasionStatuses: occasion.statuses }))).catch(() => setToast('Unable to load guest occasion configuration.')) }, [employeeMode])
 useEffect(() => { if (employeeMode) return; void maintenanceApi.configuration().then(maintenance => setConfiguration(current => ({ ...current, maintenanceAreas: maintenance.areas, maintenanceStatuses: maintenance.statuses }))).catch(() => setToast('Unable to load maintenance configuration.')) }, [employeeMode])
 useEffect(() => { if (!mobileNavigationOpen) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileNavigationOpen(false) }; document.addEventListener('keydown', closeOnEscape); return () => document.removeEventListener('keydown', closeOnEscape) }, [mobileNavigationOpen])
 const dutyOptions = configuration.dutyCodes
 const saveStaffConfiguration = async (group: 'duty-codes' | 'employment-statuses' | 'positions', option: ConfigOption) => { const prepared = group === 'duty-codes' && !option.value ? { ...option, value: `DUTY_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}` } : option; const saved = await staffApi.saveConfiguration(group, prepared); const configGroup = group === 'duty-codes' ? 'dutyCodes' : group === 'employment-statuses' ? 'employmentStatuses' : 'positions'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })); if (group !== 'duty-codes') setToast('Staff configuration saved.') }
 const activateDutyCode = async (code: string) => { await staffApi.activateDutyCode(code); const refreshed = await staffApi.configuration(); const persisted = refreshed.dutyCodes.find(item => String(item.metadata?.displayCode || item.value).trim().toUpperCase() === code.trim().toUpperCase() && item.active); if (!persisted) throw new Error(`${code.toUpperCase()} activation was not confirmed by the saved Duty Code configuration.`); setConfiguration(current => ({ ...current, dutyCodes: refreshed.dutyCodes })); setToast(`${persisted.metadata?.displayCode || persisted.value} · ${persisted.label} activated for Duty Roster.`) }
 const reorderDutyCodes = async (orderedIds: string[]) => { const previous = configuration.dutyCodes; const activeById = new Map(previous.filter(item => item.active).map(item => [item.id, item])); if (orderedIds.length !== activeById.size || new Set(orderedIds).size !== orderedIds.length || orderedIds.some(id => !activeById.has(id))) throw new Error('Duty Code order no longer matches the active configuration. Refresh and try again.'); const optimistic = [...orderedIds.map(id => activeById.get(id)!), ...previous.filter(item => !item.active)]; setConfiguration(current => ({ ...current, dutyCodes: optimistic })); try { const dutyCodes = await staffApi.reorderDutyCodes(orderedIds); setConfiguration(current => ({ ...current, dutyCodes })) } catch (error) { setConfiguration(current => ({ ...current, dutyCodes: previous })); throw error } }
 const removeDutyCode = async (id: string) => { const result = await staffApi.removeDutyCode(id); setConfiguration(current => ({ ...current, dutyCodes: result.mode === 'deleted' ? current.dutyCodes.filter(item => item.id !== id) : current.dutyCodes.map(item => item.id === id && result.option ? result.option : item) })) }
 const saveBookingConfiguration = async (group: 'statuses' | 'sources' | 'tables' | 'tableRanges' | 'walkInFields', option: ConfigOption) => { const saved = await bookingApi.saveConfiguration(group, option); if (group === 'tableRanges') { const booking = await bookingApi.configuration(); setConfiguration(current => ({ ...current, restaurantTables: booking.tables, restaurantTableRanges: booking.tableRanges })); return } const configGroup = group === 'statuses' ? 'bookingStatuses' : group === 'sources' ? 'bookingSources' : group === 'tables' ? 'restaurantTables' : 'bookingWalkInFields'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })) }
 const resetWalkInConfiguration = async () => { const fields = await bookingApi.resetWalkInFields(); setConfiguration(current => ({ ...current, bookingWalkInFields: fields })) }
 const saveChargeableConfiguration = async (group: 'items' | 'statuses' | 'wine-catalog', option: ConfigOption) => { const saved = await chargeableApi.saveConfiguration(group, option); const configGroup = group === 'items' ? 'chargeableItems' : group === 'statuses' ? 'chargeableStatuses' : 'wineSpiritCatalog'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })); setToast('Chargeable configuration saved.') }
 const saveGuestOccasionConfiguration = async (group: 'types' | 'statuses', option: ConfigOption) => { const saved = await guestOccasionApi.saveConfiguration(group, option); const configGroup = group === 'types' ? 'occasionTypes' : 'occasionStatuses'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })); setToast('Guest occasion configuration saved.') }
 const saveMaintenanceConfiguration = async (group: 'areas' | 'statuses', option: ConfigOption) => { const saved = await maintenanceApi.saveConfiguration(group, option); const configGroup = group === 'areas' ? 'maintenanceAreas' : 'maintenanceStatuses'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })); setToast('Maintenance configuration saved.') }
 const updateStaff = async (record: Staff) => { const existing = staff.some(item => item.id === record.id); const saved = existing ? await staffApi.update(record) : await staffApi.create(record); setStaff(current => current.some(item => item.id === saved.id) ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved]); setToast(`${saved.name} saved. Changes persist in the staff data store.`) }
 const reorderStaff = async (orderedIds: string[]) => { const previous = staff; const byId = new Map(previous.map(person => [person.id, person])); if (orderedIds.length !== previous.length || new Set(orderedIds).size !== previous.length || orderedIds.some(id => !byId.has(id))) throw new Error('Staff order no longer matches the Team Directory. Refresh and try again.'); setStaff(orderedIds.map(id => byId.get(id)!)); try { setStaff(await staffApi.reorder(orderedIds)); setToast('Shared staff display order saved.') } catch (error) { setStaff(previous); throw error } }
 const navigate = (destination: string) => { if (page === 'Duty Roster' && rosterUnsaved && !window.confirm('You have unsaved Duty Roster changes. Leave this page and discard them?')) return; if (page === 'Reports' && reportsUnsaved && !window.confirm('You have unsaved Daily Report changes. Leave Reports and discard them?')) return; if (destination === 'Maintenance') setMaintenanceTargetId(null); if (destination === 'Leave Planner') setLeavePlannerTarget(null); setPage(destination); setMobileNavigationOpen(false) }
 const pageContext = page === 'Staff Management' ? staffPageContext : visibleNavigation.find(item => item.label === page)?.eyebrow || 'OPERATIONS'
 return <div className="app-shell">
{mobileNavigationOpen && <button className="navigation-backdrop" aria-label="Close navigation menu" onClick={() => setMobileNavigationOpen(false)} />}
<aside id="application-navigation" className={`app-sidebar${mobileNavigationOpen ? ' mobile-open' : ''}`}>
<div className="brand">
<BrandWordmark className="sidebar-wordmark" />
<IconAction icon="close" className="drawer-close" label="Close navigation menu" onClick={() => setMobileNavigationOpen(false)}/>
</div>
<nav aria-label="Application modules">{visibleNavigation.map(item => <button key={item.label} type="button" aria-current={page === item.label ? 'page' : undefined} aria-label={item.label} title={item.label} onClick={() => navigate(item.label)} className={page === item.label ? 'selected' : ''}>
<span className="nav-icon" aria-hidden="true">{item.icon}</span>
<span className="nav-label">{item.label}</span>
</button>)}</nav>
<div className="sidebar-footer">Siyam World Maldives<br/>
<small>Venue operations</small>
</div>
</aside>
<main className={`${moduleThemeClass(page)}${page === 'Incentives & Bill Tips' ? ' financial-main' : ''}`}>
<div className="mobile-topbar">
<button className="menu-button" type="button" aria-label="Open navigation menu" title="Open navigation menu" aria-expanded={mobileNavigationOpen} aria-controls="application-navigation" onClick={() => setMobileNavigationOpen(true)}>☰</button>
<div className="mobile-brand">
<BrandWordmark className="mobile-wordmark" />
</div>
<AuthUserButton />
</div>
<header className={`page-header${page === 'Reports' ? ' reports-header' : ''}${page === 'Staff Management' ? ' staff-management-header' : ''}${page === 'Training' ? ' training-page-header' : ''}${page === 'Guest Occasions' ? ' guest-occasions-page-header' : ''}${page === 'Incentives & Bill Tips' ? ' financial-page-header' : ''}${page === 'Customization Center' ? ' customization-page-header' : ''}`}>
<div>
<p className="eyebrow">{pageContext}</p>
<h1>{page}</h1>
</div>
<div className="header-actions">{page === 'Reports' && <span className="report-header-date">{reportHeaderDate}</span>}<AuthUserButton />
</div>
</header>
{toast && <div className="toast" role="status" aria-live="polite">{toast}<IconAction icon="close" label="Dismiss notification" onClick={() => setToast('')}/>
</div>}
{page === 'My Timesheet' && <MyTimesheetPage />}
{page === 'Dashboard' && <Dashboard userDisplayName={user.displayName} staff={staff} dutyOptions={dutyOptions} bookingStatuses={configuration.bookingStatuses} occasionTypes={configuration.occasionTypes} maintenanceStatuses={configuration.maintenanceStatuses} onRoster={() => setPage('Duty Roster')} onBookings={() => setPage('Bookings')} onOccasions={() => setPage('Guest Occasions')} onTraining={() => setPage('Training')} onMaintenance={recordId => { setMaintenanceTargetId(recordId); setPage('Maintenance') }} />}
{page === 'Staff Management' && <StaffManagement staff={staff} configuration={configuration} loading={staffLoading} error={staffError} onRetry={loadStaff} onSave={updateStaff} onReorder={reorderStaff} onToast={setToast} onAddStaff={() => setShowStaff(true)} onOpenLeaveHistory={staffId => { setLeavePlannerTarget({ view: 'history', staffId }); setPage('Leave Planner') }} onSectionContextChange={setStaffPageContext} canManageStaff={user.permissionKeys.includes('manage_staff')} canManageAccounts={user.permissionKeys.includes('manage_users')} canManageTimesheets={user.permissionKeys.includes('manage_timesheets')} />}
 {page === 'Duty Roster' && <DutyRosterPage staff={staff} dutyOptions={dutyOptions} positions={configuration.positions} onToast={setToast} onDirtyChange={setRosterUnsaved} onSaveDutyCode={option => saveStaffConfiguration('duty-codes', option)} onReorderDutyCodes={reorderDutyCodes} onRemoveDutyCode={removeDutyCode} />}
{page === 'Leave Planner' && <LeavePlannerWorkspace staff={staff} configuration={configuration} onActivateDutyCode={activateDutyCode} initialView={leavePlannerTarget?.view} initialStaffId={leavePlannerTarget?.staffId} />}
{page === 'Training' && <TrainingPage staff={staff} configuration={{ categories: configuration.trainingCategories, statuses: configuration.trainingStatuses, attendanceStatuses: configuration.trainingAttendanceStatuses, ...trainingCustomization }} onToast={setToast} />}
{page === 'Bookings' && <BookingsPage staff={staff} configuration={{ statuses: configuration.bookingStatuses, sources: configuration.bookingSources, tables: configuration.restaurantTables, tableRanges: configuration.restaurantTableRanges, walkInFields: configuration.bookingWalkInFields, occasionTypes: configuration.occasionTypes }} onToast={setToast} initialBooking={reportBooking} />}
{page === 'Guest Occasions' && <GuestOccasionsPage staff={staff} configuration={{ types: configuration.occasionTypes, statuses: configuration.occasionStatuses, tables: configuration.restaurantTables }} onToast={setToast} />}
{page === 'Incentives & Bill Tips' && <IncentivesBillTipsPage staff={staff} configuration={{ items: configuration.chargeableItems, statuses: configuration.chargeableStatuses, tables: configuration.restaurantTables }} onToast={setToast} />}
{page === 'Maintenance' && <MaintenancePage staff={staff} authenticatedStaffId={user.staffId} configuration={{ areas: configuration.maintenanceAreas, statuses: configuration.maintenanceStatuses }} focusedRecordId={maintenanceTargetId} onToast={setToast} />}
{page === 'Reports' && <ReportsPage onToast={setToast} onPeriodLabelChange={setReportHeaderDate} onUnsavedChange={setReportsUnsaved} onOpenBooking={(id,date) => { if (reportsUnsaved && !window.confirm('You have unsaved Daily Report changes. Open Bookings and discard them?')) return; setReportBooking({ id, date }); setPage('Bookings') }} />}
 {page === 'Customization Center' && <CustomizationCenter configuration={configuration} trainingCustomization={trainingCustomization} staff={staff} onTrainingChanged={applyTrainingConfiguration} onSaveBooking={saveBookingConfiguration} onResetWalkIn={resetWalkInConfiguration} onSaveChargeable={saveChargeableConfiguration} onSaveGuestOccasion={saveGuestOccasionConfiguration} onSaveMaintenance={saveMaintenanceConfiguration} />}
{!['My Timesheet','Dashboard','Staff Management','Duty Roster','Leave Planner','Training','Bookings','Guest Occasions','Incentives & Bill Tips','Maintenance','Reports','Customization Center'].includes(page) && <ComingSoon page={page} />}</main>{showStaff && <StaffForm title="Add staff member" configuration={configuration} onClose={() => setShowStaff(false)} onSave={async record => { await updateStaff(record); setShowStaff(false) }} />}</div>
}
type CustomizationCategory = 'bookings' | 'training' | 'guest-experience' | 'commercial' | 'maintenance' | 'platform'
const customizationCategories: Array<{ id: CustomizationCategory; label: string }> = [
 { id: 'bookings', label: 'Bookings' },
 { id: 'training', label: 'Training' },
 { id: 'guest-experience', label: 'Guest Experience' },
 { id: 'commercial', label: 'Chargeable' },
 { id: 'maintenance', label: 'Maintenance' }
]
function CustomizationCenter({ configuration, trainingCustomization, staff, onTrainingChanged, onSaveBooking, onResetWalkIn, onSaveChargeable, onSaveGuestOccasion, onSaveMaintenance }: { configuration: typeof config; trainingCustomization: TrainingCustomization; staff: Staff[]; onTrainingChanged: (training: Awaited<ReturnType<typeof trainingApi.configuration>>) => void; onSaveBooking: (group: 'statuses' | 'sources' | 'tables' | 'tableRanges' | 'walkInFields', option: ConfigOption) => Promise<void>; onResetWalkIn: () => Promise<void>; onSaveChargeable: (group: 'items' | 'statuses' | 'wine-catalog', option: ConfigOption) => Promise<void>; onSaveGuestOccasion: (group: 'types' | 'statuses', option: ConfigOption) => Promise<void>; onSaveMaintenance: (group: 'areas' | 'statuses', option: ConfigOption) => Promise<void> }) {
 const { user } = useAuth()
 const [category, setCategory] = useState<CustomizationCategory>('bookings')
 const categories = user.isOwner ? [...customizationCategories, { id: 'platform' as const, label: 'Platform' }] : customizationCategories
 return <section className="customization-center">
 <nav className={`customization-category-nav${categories.length === 7 ? ' seven-categories' : ''}`} aria-label="Customization categories">{categories.map(item => <button key={item.id} type="button" className={category === item.id ? 'selected' : ''} aria-current={category === item.id ? 'page' : undefined} onClick={() => setCategory(item.id)}>{item.label}</button>)}</nav>
 <div className="customization-category-panel" aria-label={`${categories.find(item => item.id === category)?.label} configuration`}>
 {category === 'bookings' && <BookingConfigurationManager configuration={{ statuses: configuration.bookingStatuses, sources: configuration.bookingSources, tables: configuration.restaurantTables, tableRanges: configuration.restaurantTableRanges, walkInFields: configuration.bookingWalkInFields }} onSave={onSaveBooking} onResetWalkIn={onResetWalkIn} />}
 {category === 'training' && <TrainingConfigurationManager staff={staff} configuration={{ categories: configuration.trainingCategories, statuses: configuration.trainingStatuses, attendanceStatuses: configuration.trainingAttendanceStatuses, ...trainingCustomization }} onChanged={onTrainingChanged} />}
 {category === 'guest-experience' && <GuestOccasionConfigurationManager configuration={{ types: configuration.occasionTypes, statuses: configuration.occasionStatuses }} onSave={onSaveGuestOccasion} />}
 {category === 'commercial' && <ChargeableConfigurationManager configuration={{ items: configuration.chargeableItems, statuses: configuration.chargeableStatuses, wineCatalog: configuration.wineSpiritCatalog }} onSave={onSaveChargeable} />}
 {category === 'maintenance' && <MaintenanceConfigurationManager configuration={{ areas: configuration.maintenanceAreas, statuses: configuration.maintenanceStatuses }} onSave={onSaveMaintenance} />}
 {category === 'platform' && user.isOwner && <DatabaseHealthPanel />}
 </div>
 </section>
}
function StaffManagement({ staff, configuration, loading, error, onRetry, onSave, onReorder, onToast, onAddStaff, onOpenLeaveHistory, onSectionContextChange, canManageStaff, canManageAccounts, canManageTimesheets }: { staff: Staff[]; configuration: typeof config; loading: boolean; error: string; onRetry: () => Promise<void>; onSave: (staff: Staff) => Promise<void>; onReorder: (orderedIds: string[]) => Promise<void>; onToast: (message: string) => void; onAddStaff: () => void; onOpenLeaveHistory: (staffId: string) => void; onSectionContextChange: (context: string) => void; canManageStaff: boolean; canManageAccounts: boolean; canManageTimesheets: boolean }) {
 const [section, setSection] = useState<'directory' | 'membership' | 'accounts' | 'timesheets'>('directory'); const [query, setQuery] = useState(''); const [position, setPosition] = useState('all'); const [employmentStatus, setEmploymentStatus] = useState('all'); const [sort, setSort] = useState<'display' | 'name' | 'number' | 'joinDate'>('display'); const [filtersOpen, setFiltersOpen] = useState(false); const [editor, setEditor] = useState<Staff | 'new' | null>(null); const [viewer, setViewer] = useState<Staff | null>(null); const [todayRoster, setTodayRoster] = useState<RosterEntry[]>([]); const [directoryOrder, setDirectoryOrder] = useState(staff); const [draggingStaffId, setDraggingStaffId] = useState<string | null>(null); const [staffDropTarget, setStaffDropTarget] = useState<{ id: string; after: boolean } | null>(null); const [savingOrder, setSavingOrder] = useState(false); const directoryOrderRef = useRef(staff); const staffPointer = useRef<{ id: string; pointerId: number; startX: number; startY: number; active: boolean; targetId: string | null; targetAfter: boolean; timer: number } | null>(null)
 useEffect(() => { onSectionContextChange(section === 'membership' ? 'TEAM MEMBERSHIP' : 'TEAM DIRECTORY') }, [section, onSectionContextChange])
 useEffect(() => { let current = true; void operationsApi.roster(serviceDate(), serviceDate()).then(records => { if (current) setTodayRoster(records) }).catch(() => { if (current) setTodayRoster([]) }); return () => { current = false } }, [staff])
 useEffect(() => { if (draggingStaffId || savingOrder) return; directoryOrderRef.current = staff; setDirectoryOrder(staff) }, [staff, draggingStaffId, savingOrder])
 const statusOption = (value: string) => configuration.employmentStatuses.find(option => option.value === value)
 const dutyFor = (person: Staff) => todayRoster.find(entry => entry.staffId === person.id)
 const dutyOptionFor = (person: Staff) => configuration.dutyCodes.find(option => option.value === dutyFor(person)?.dutyCode)
 const positionLabel = (person: Staff) => designationLabel(person.position, configuration.positions)
 const visibleStaff = directoryOrder.filter(person => (position === 'all' || person.position === position) && (employmentStatus === 'all' || person.employmentStatus === employmentStatus) && staffDirectorySearchText(person, configuration.positions).includes(query.toLowerCase())).sort((a, b) => sort === 'display' ? 0 : sort === 'number' ? a.number.localeCompare(b.number) : sort === 'joinDate' ? a.joinDate.localeCompare(b.joinDate) : a.name.localeCompare(b.name))
 const operationalStaff = staff.filter(person => person.assignmentEligible)
 const workingToday = new Set(operationalStaff.filter(person => dutyOptionFor(person)?.metadata?.countsAsWorking).map(person => person.id)).size
 const offToday = new Set(operationalStaff.filter(person => ['off', 'publicHoliday'].includes(dutyOptionFor(person)?.metadata?.dutyClassification || '')).map(person => person.id)).size
 const onLeave = new Set(operationalStaff.filter(person => { const classification = dutyOptionFor(person)?.metadata?.dutyClassification; return isLeaveClassification(classification) && classification !== 'off' }).map(person => person.id)).size
 const archive = async (person: Staff) => { if (!window.confirm(`Archive ${person.name}? Historical roster and booking records will remain linked to this employee.`)) return; try { await onSave({ ...person, employmentStatus: 'inactive', resignationDate: person.resignationDate || serviceDate() }); setViewer(null); onToast(`${person.name} was archived. Historical operational records were preserved.`) } catch (saveError) { onToast(saveError instanceof Error ? saveError.message : 'Unable to archive staff member.') } }
 const moveStaff = (id: string, targetId: string, after: boolean) => { const current = directoryOrderRef.current; const source = current.find(item => item.id === id); if (!source || id === targetId) return current; const without = current.filter(item => item.id !== id); const target = without.findIndex(item => item.id === targetId); if (target < 0) return current; const next = [...without]; next.splice(target + (after ? 1 : 0), 0, source); directoryOrderRef.current = next; setDirectoryOrder(next); return next }
 const persistStaffOrder = async (next: Staff[]) => { if (savingOrder || next.map(item => item.id).join('|') === staff.map(item => item.id).join('|')) return; setSavingOrder(true); try { await onReorder(next.map(person => person.id)) } catch (saveError) { directoryOrderRef.current = staff; setDirectoryOrder(staff); const detail = saveError instanceof Error ? saveError.message : 'Unable to save the new staff order.'; onToast(`${detail} The previous staff order was restored.`) } finally { setSavingOrder(false) } }
 const moveStaffFromPoint = (x: number, y: number) => { const state = staffPointer.current; if (!state?.active) return; const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-staff-row-id]'); if (!row?.dataset.staffRowId || row.dataset.staffRowId === state.id) return; const bounds = row.getBoundingClientRect(); state.targetId = row.dataset.staffRowId; state.targetAfter = y >= bounds.top + bounds.height / 2; setStaffDropTarget({ id: state.targetId, after: state.targetAfter }) }
 const staffPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => { if (savingOrder) return; event.stopPropagation(); setSort('display'); setStaffDropTarget(null); const handle = event.currentTarget; const capture = () => { try { handle.setPointerCapture(event.pointerId) } catch { /* Synthetic accessibility tests may not own a native pointer. */ } }; const state = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: event.pointerType === 'mouse', targetId: null, targetAfter: false, timer: 0 }; staffPointer.current = state; if (state.active) { event.preventDefault(); capture(); setDraggingStaffId(id) } else state.timer = window.setTimeout(() => { state.active = true; capture(); setDraggingStaffId(id) }, 350) }
 const staffPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => { const state = staffPointer.current; if (!state || state.pointerId !== event.pointerId) return; if (!state.active && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 8) { window.clearTimeout(state.timer); staffPointer.current = null; return } if (state.active) { event.preventDefault(); moveStaffFromPoint(event.clientX, event.clientY) } }
 const staffPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => { const state = staffPointer.current; if (!state || state.pointerId !== event.pointerId) return; window.clearTimeout(state.timer); staffPointer.current = null; setDraggingStaffId(null); setStaffDropTarget(null); if (state.active && state.targetId) void persistStaffOrder(moveStaff(state.id, state.targetId, state.targetAfter)) }
 const staffPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => { const state = staffPointer.current; if (!state || state.pointerId !== event.pointerId) return; window.clearTimeout(state.timer); staffPointer.current = null; setDraggingStaffId(null); setStaffDropTarget(null) }
 const staffKeyboardMove = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => { if (!['ArrowUp', 'ArrowDown'].includes(event.key) || savingOrder) return; event.preventDefault(); setSort('display'); const index = directoryOrderRef.current.findIndex(item => item.id === id); const target = event.key === 'ArrowUp' ? index - 1 : index + 1; if (target < 0 || target >= directoryOrderRef.current.length) return; const next = moveStaff(id, directoryOrderRef.current[target].id, event.key === 'ArrowDown'); void persistStaffOrder(next) }
 const staffDragHandle = (person: Staff) => canManageStaff ? <IconAction icon="grip" label={`Move ${person.name}`} className="direct-staff-drag-handle" disabled={savingOrder} title="Drag to reorder staff; touch and hold on mobile; use Arrow Up or Arrow Down with the keyboard" onPointerDown={event => staffPointerDown(event, person.id)} onPointerMove={staffPointerMove} onPointerUp={staffPointerEnd} onPointerCancel={staffPointerCancel} onKeyDown={event => staffKeyboardMove(event, person.id)} /> : null
 return <>{loading && <section className="panel inline-state">
<p>Loading staff records…</p>
</section>}{error && <section className="panel inline-state error-state">
<p>{error}</p>
<ActionButton icon="refresh" onClick={() => void onRetry()}>Try again</ActionButton>
</section>}{!loading && !error && <>
<div className="staff-section-bar"><nav className="staff-section-tabs" aria-label="Staff Management sections"><button className={section === 'directory' ? 'selected' : ''} aria-pressed={section === 'directory'} onClick={() => setSection('directory')}>Team Directory</button>{canManageTimesheets && <button className={section === 'timesheets' ? 'selected' : ''} aria-pressed={section === 'timesheets'} onClick={() => setSection('timesheets')}>Timesheets</button>}<button className={section === 'membership' ? 'selected' : ''} aria-pressed={section === 'membership'} onClick={() => setSection('membership')}>Team Membership</button>{canManageAccounts && <button className={section === 'accounts' ? 'selected' : ''} aria-pressed={section === 'accounts'} onClick={() => setSection('accounts')}>Account Management</button>}</nav>{section === 'directory' && <ActionButton variant="primary" icon="add" className="staff-section-add" onClick={onAddStaff}>Add Staff Member</ActionButton>}</div>
{section === 'directory' && <div className="staff-directory-page">
<section className="staff-summary">
<article className="panel"><span>Total Staff</span><strong>{staff.length}</strong></article>
<article className="panel"><span>Working Today</span><strong>{workingToday}</strong></article>
<article className="panel"><span>Off Today</span><strong>{offToday}</strong></article>
<article className="panel"><span>On Leave</span><strong>{onLeave}</strong></article>
</section>
<section className="panel staff-panel">
<div className="staff-tools">
<div className="staff-search-row"><input aria-label="Search staff" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search staff name or number" /><ActionButton className="staff-filter-toggle" icon="filter" compact aria-expanded={filtersOpen} aria-controls="staff-directory-filters" onClick={() => setFiltersOpen(open => !open)}>Filters{[position !== 'all', employmentStatus !== 'all', sort !== 'display'].filter(Boolean).length ? ` (${[position !== 'all', employmentStatus !== 'all', sort !== 'display'].filter(Boolean).length})` : ''}</ActionButton></div>
<div id="staff-directory-filters" className={`staff-filter-fields${filtersOpen ? ' open' : ''}`}>
<select aria-label="Filter by position" value={position} onChange={event => setPosition(event.target.value)}>
<option value="all">All designations</option>{configuration.positions.filter(option => option.active).map(option => <option value={option.value} key={option.id}>{option.label}</option>)}</select>
<select aria-label="Filter by employment status" value={employmentStatus} onChange={event => setEmploymentStatus(event.target.value)}>
<option value="all">All employment statuses</option>{configuration.employmentStatuses.filter(option => option.active).map(option => <option value={option.value} key={option.id}>{option.label}</option>)}</select>
<select aria-label="Sort staff" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="display">Staff display order</option><option value="name">Sort by name</option><option value="number">Sort by Employee ID</option><option value="joinDate">Sort by joining date</option></select>
</div>
</div>
<div className="staff-table-wrap" tabIndex={0} aria-label="Staff records table">
<table className="staff-table">
<thead>
<tr>
<th>Staff</th>
<th>Employee ID</th>
<th>Designation</th>
<th>Status</th>
<th>Today</th>
<th>Date of Joining</th>
  <th>Actions</th>
</tr>
</thead>
<tbody>{visibleStaff.map(person => <tr key={person.id} data-staff-row-id={person.id} className={`${draggingStaffId === person.id ? 'is-dragging ' : ''}${staffDropTarget?.id === person.id ? staffDropTarget.after ? 'drop-after' : 'drop-before' : ''}`.trim() || undefined}>
  <td className="staff-name-cell">
    <div className="staff-table-identity">{staffDragHandle(person)}<b>{person.name}</b></div>
  </td>
<td>{person.number}</td>
<td className="staff-designation">{positionLabel(person)}</td>
<td>
<span className="badge staff-status" style={{ borderColor: statusOption(person.employmentStatus)?.color, color: statusOption(person.employmentStatus)?.color }}>{statusOption(person.employmentStatus)?.label || person.employmentStatus}</span>
</td>
<td><span className={`today-duty${dutyOptionFor(person) ? '' : ' unassigned'}`} style={dutyOptionFor(person) ? { backgroundColor: dutyOptionFor(person)?.color, borderColor: dutyOptionFor(person)?.color, color: readableDutyText(dutyOptionFor(person)?.color) } : undefined} title={dutyOptionFor(person) ? `${dutyDisplayCode(dutyOptionFor(person))} · ${dutyOptionFor(person)?.label}` : 'No duty assigned'}>{dutyOptionFor(person) ? dutyDisplayCode(dutyOptionFor(person)) : 'Unassigned'}</span></td>
<td>{formatDate(person.joinDate)}</td>
<td className="row-actions staff-row-icon-actions">
<IconAction icon="user" label={`View profile for ${person.name}`} data-staff-action="view" onClick={() => setViewer(person)} />
<IconAction icon="edit" label={`Edit ${person.name}`} data-staff-action="edit" onClick={() => setEditor(person)} />
{person.assignmentEligible && <IconAction icon="archive" tone="danger" label={`Archive ${person.name}`} data-staff-action="archive" onClick={() => void archive(person)} />}
</td>
</tr>)}</tbody>
</table>{visibleStaff.length === 0 && <div className="inline-empty">No staff records match the current search or filters.</div>}</div><div className="staff-mobile-cards">{visibleStaff.map(person => <article className={`staff-mobile-card${draggingStaffId === person.id ? ' is-dragging' : ''}${staffDropTarget?.id === person.id ? staffDropTarget.after ? ' drop-after' : ' drop-before' : ''}`} data-staff-row-id={person.id} key={person.id}><header><div className="staff-mobile-identity">{staffDragHandle(person)}<span><b>{person.name}</b><small>{person.number}</small></span></div><span className="badge staff-status" style={{ borderColor: statusOption(person.employmentStatus)?.color, color: statusOption(person.employmentStatus)?.color }}>{statusOption(person.employmentStatus)?.label || person.employmentStatus}</span></header><dl><div><dt>Designation</dt><dd>{positionLabel(person)}</dd></div><div><dt>Today</dt><dd><span className={`today-duty${dutyOptionFor(person) ? '' : ' unassigned'}`} style={dutyOptionFor(person) ? { backgroundColor: dutyOptionFor(person)?.color, borderColor: dutyOptionFor(person)?.color, color: readableDutyText(dutyOptionFor(person)?.color) } : undefined}>{dutyOptionFor(person) ? dutyDisplayCode(dutyOptionFor(person)) : 'Unassigned'}</span></dd></div><div><dt>Joined</dt><dd>{formatDate(person.joinDate)}</dd></div></dl><div className="staff-row-icon-actions"><IconAction icon="user" label={`View profile for ${person.name}`} data-staff-action="view" onClick={() => setViewer(person)} /><IconAction icon="edit" label={`Edit ${person.name}`} data-staff-action="edit" onClick={() => setEditor(person)} />{person.assignmentEligible && <IconAction icon="archive" tone="danger" label={`Archive ${person.name}`} data-staff-action="archive" onClick={() => void archive(person)} />}</div></article>)}</div>
</section>{editor && <StaffForm title={editor === 'new' ? 'Add Staff Member' : 'Edit Staff Member'} staff={editor === 'new' ? undefined : editor} configuration={configuration} onClose={() => setEditor(null)} onSave={async record => { await onSave(record); setEditor(null) }} />}{viewer && <StaffProfileDrawer staff={viewer} configuration={configuration} onClose={() => setViewer(null)} onEdit={() => { setEditor(viewer); setViewer(null) }} onArchive={() => void archive(viewer)} onViewLeaveHistory={() => { onOpenLeaveHistory(viewer.id); setViewer(null) }} />}</div>}{section === 'timesheets' && canManageTimesheets && <ManagerTimesheets />}{section === 'membership' && <StaffMembershipBaselinePanel staff={staff} employmentStatuses={configuration.employmentStatuses} />}{section === 'accounts' && canManageAccounts && <StaffAccountManagement onToast={onToast} />}</>}</>
}
function StaffForm({ title, staff, configuration, onClose, onSave }: { title: string; staff?: Staff; configuration: typeof config; onClose: () => void; onSave: (staff: Staff) => Promise<void> }) {
 const initial = useRef<Staff>(staff || { id: crypto.randomUUID(), name: '', number: '', position: configuration.positions.find(option => option.active)?.value || '', nationality: '', division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: '', employmentStatus: configuration.employmentStatuses.find(option => option.value === 'active' && option.active)?.value || configuration.employmentStatuses.find(option => option.active)?.value || '', joinDate: serviceDate() })
 const [form, setForm] = useState<Staff>(initial.current); const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState('')
 const change = (field: keyof Staff, value: string) => setForm(current => ({ ...current, [field]: value }))
 const inactiveStage = configuration.employmentStatuses.find(option => option.value === form.employmentStatus)?.metadata?.employmentStage === 'inactive'
 const dirty = JSON.stringify(form) !== JSON.stringify(initial.current)
 const requestDismiss = () => { if (saving) return; if (dirty && !window.confirm('Discard unsaved staff changes?')) return; onClose() }
 const submit = async (event: FormEvent) => { event.preventDefault(); const nextErrors: Record<string, string> = {}; if (!form.number.trim()) nextErrors.number = 'Employee ID is required.'; if (!form.name.trim()) nextErrors.name = 'Name is required.'; if (!form.position) nextErrors.position = 'Designation is required.'; if (!form.employmentStatus) nextErrors.employmentStatus = 'Employment status is required.'; if (!form.joinDate || Number.isNaN(Date.parse(`${form.joinDate}T00:00:00Z`))) nextErrors.joinDate = 'A valid date of joining is required.'; if (form.resignationDate && form.joinDate && form.resignationDate < form.joinDate) nextErrors.resignationDate = 'Resignation date cannot be before the joining date.'; setErrors(nextErrors); if (Object.keys(nextErrors).length) return; setSaving(true); setSaveError(''); try { await onSave({ ...form, name: form.name.trim(), number: form.number.trim(), nationality: form.nationality.trim(), division: form.division.trim(), department: form.department.trim(), outlet: form.outlet.trim() || 'Andalucía', identityDocumentNumber: form.identityDocumentNumber.trim(), resignationDate: inactiveStage ? form.resignationDate : undefined }) } catch (error) { setSaveError(error instanceof Error ? error.message : 'Unable to save staff member.') } finally { setSaving(false) } }
 return <Modal title={title} onClose={requestDismiss} wide className="staff-edit-modal" showClose={false} closeOnBackdrop closeOnEscape lockBackgroundScroll headerContent={<p className="staff-edit-intro">Update the employee identity, role and operational assignment.</p>}>
<form className="staff-form staff-profile-form" onSubmit={event => void submit(event)}>
<div className="staff-edit-scroll"><section className="staff-edit-section"><p className="eyebrow">IDENTITY &amp; ROLE</p><div className="staff-edit-grid">
<label>Employee ID<input value={form.number} onChange={event => change('number', event.target.value)} placeholder="e.g. SW2330" />{errors.number && <small className="field-error">{errors.number}</small>}</label>
<label>Name<input value={form.name} onChange={event => change('name', event.target.value)} placeholder="e.g. Kapil" />{errors.name && <small className="field-error">{errors.name}</small>}</label>
<label>Designation<select value={form.position} onChange={event => change('position', event.target.value)}>
<option value="">Select a position</option>{configuration.positions.filter(option => option.active || option.value === form.position).map(option => <option key={option.id} value={option.value}>{option.label}{option.active ? '' : ' (Inactive)'}</option>)}</select>{errors.position && <small className="field-error">{errors.position}</small>}</label>
<label>Employment status<select value={form.employmentStatus} onChange={event => change('employmentStatus', event.target.value)}>
<option value="">Select a status</option>{configuration.employmentStatuses.filter(option => option.active || option.value === form.employmentStatus).map(option => <option key={option.id} value={option.value}>{option.label}{option.active ? '' : ' (Inactive)'}</option>)}</select>{errors.employmentStatus && <small className="field-error">{errors.employmentStatus}</small>}</label>
<label>Date of joining<DateControl label="Date of joining" value={form.joinDate} onChange={event => change('joinDate', event.target.value)} />{errors.joinDate && <small className="field-error">{errors.joinDate}</small>}</label><label>Nationality<input value={form.nationality} onChange={event => change('nationality', event.target.value)} /></label></div></section>
<section className="staff-edit-section"><p className="eyebrow">OPERATIONAL DETAILS</p><div className="staff-edit-grid"><label>Division<input value={form.division} onChange={event => change('division', event.target.value)} /></label><label>Department<input value={form.department} onChange={event => change('department', event.target.value)} /></label><label>Outlet<input value={form.outlet} onChange={event => change('outlet', event.target.value)} /></label><label>ID / Passport No.<input value={form.identityDocumentNumber} onChange={event => change('identityDocumentNumber', event.target.value)} /></label>{inactiveStage && <label>Separation date<DateControl label="Separation date" value={form.resignationDate || ''} onChange={event => change('resignationDate', event.target.value)} />{errors.resignationDate && <small className="field-error">{errors.resignationDate}</small>}</label>}</div></section>{saveError && <p className="save-error staff-form-error">{saveError}</p>}</div><div className="form-actions">
<ActionButton type="button" onClick={requestDismiss}>Cancel</ActionButton>
<ActionButton type="submit" variant="primary" icon="save" disabled={saving}>{saving ? 'Saving…' : 'Save staff member'}</ActionButton>
</div>
</form>
</Modal>
}
function StaffProfileDrawer({ staff, configuration, onClose, onEdit, onArchive, onViewLeaveHistory }: { staff: Staff; configuration: typeof config; onClose: () => void; onEdit: () => void; onArchive: () => void; onViewLeaveHistory: () => void }) {
 const status = configuration.employmentStatuses.find(option => option.value === staff.employmentStatus)
 const position = designationLabel(staff.position, configuration.positions)
 const item = (label: string, value: string) => <div><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>
 const previousFocus = useRef<HTMLElement | null>(null); const onCloseRef = useRef(onClose)
 useEffect(() => { onCloseRef.current = onClose }, [onClose])
 useEffect(() => { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current() } }; document.addEventListener('keydown', keydown); return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = previousOverflow; previousFocus.current?.focus() } }, [])
 return <div className="staff-profile-overlay" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}><aside className="staff-profile-drawer" role="dialog" aria-modal="true" aria-label={`Staff profile for ${staff.name}`}><header className="staff-profile-header"><div className="staff-profile-heading"><p className="eyebrow">STAFF PROFILE</p><h2>{staff.name}</h2><div className="staff-profile-meta"><span>{position}</span><span aria-label={`Employee ID ${staff.number}`}>{staff.number}</span></div></div><StatusPill tone="navy" className="staff-status" style={{ borderColor: status?.color, color: status?.color }}>{status?.label || staff.employmentStatus}</StatusPill></header><div className="staff-profile-scroll"><section className="staff-profile-employment"><p className="eyebrow">EMPLOYMENT INFORMATION</p><dl className="staff-profile-grid">{item('Name', staff.name)}{item('Employee ID', staff.number)}{item('Designation', position)}{item('Date of Joining', formatDate(staff.joinDate))}{item('Nationality', staff.nationality)}{item('Division', staff.division)}{item('Department', staff.department)}{item('Outlet', staff.outlet || 'Andalucía')}{item('ID / Passport No.', staff.identityDocumentNumber)}{item('Employment Status', status?.label || staff.employmentStatus)}</dl></section><StaffLeaveAvailability staff={staff} onViewFull={onViewLeaveHistory} /><StaffTrainingHistoryPanel staffId={staff.id} configuration={{ categories: configuration.trainingCategories, statuses: configuration.trainingStatuses, attendanceStatuses: configuration.trainingAttendanceStatuses }} /></div><footer><ActionButton icon="edit" onClick={onEdit}>Edit Staff</ActionButton>{staff.assignmentEligible && <ActionButton className="staff-profile-archive" icon="archive" onClick={onArchive}>Archive Staff</ActionButton>}</footer></aside></div>
}
function formatDate(value: string) { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) }
const countsAsAttendanceException = (record: AttendanceRecord, statuses: ConfigOption[]) => Boolean(statuses.find(status => status.value === record.attendanceStatus)?.metadata?.countsAsException)
const dashboardGeometryStorageKey = () => {
 const width = window.innerWidth
 const band = width <= 360 ? '360' : width <= 390 ? '390' : width <= 430 ? '430' : width <= 768 ? '768' : width <= 1024 ? '1024' : width <= 1280 ? '1280' : '1440'
 return `andalucia-dashboard-stable-height-v1:${band}`
}
const storedDashboardHeight = () => { try { const height = Number(window.sessionStorage.getItem(dashboardGeometryStorageKey())); return Number.isFinite(height) && height > 0 ? height : null } catch { return null } }
const storeDashboardHeight = (height: number) => { try { window.sessionStorage.setItem(dashboardGeometryStorageKey(), String(Math.ceil(height))) } catch { /* Browser storage can be unavailable without affecting Dashboard rendering. */ } }
type DashboardLoadPayload = { roster: RosterEntry[]; bookings: BookingRecord[]; report: OperationalReport; maintenanceRecords: MaintenanceRecord[]; trainingSessions: TrainingSession[] }
const dashboardLoads = new Map<string, Promise<DashboardLoadPayload>>()
const loadDashboardPayload = (date: string) => {
 const pending = dashboardLoads.get(date)
 if (pending) return pending
 const request = Promise.all([operationsApi.roster(date, date), bookingApi.list(date), reportingApi.report('today', date, date), maintenanceApi.list(), trainingApi.list()]).then(([roster, bookings, report, maintenanceRecords, trainingSessions]) => ({ roster, bookings, report, maintenanceRecords, trainingSessions }))
 dashboardLoads.set(date, request)
 const clear = () => { if (dashboardLoads.get(date) === request) dashboardLoads.delete(date) }
 void request.then(clear, clear)
 return request
}
function Dashboard({ userDisplayName, staff, dutyOptions, bookingStatuses, occasionTypes, maintenanceStatuses, onRoster, onBookings, onOccasions, onTraining, onMaintenance }: { userDisplayName: string; staff: Staff[]; dutyOptions: ConfigOption[]; bookingStatuses: ConfigOption[]; occasionTypes: ConfigOption[]; maintenanceStatuses: ConfigOption[]; onRoster: () => void; onBookings: () => void; onOccasions: () => void; onTraining: () => void; onMaintenance: (recordId: string) => void }) {
 const [dashboardDate, setDashboardDate] = useState(() => serviceDate()); const [dashboardTime, setDashboardTime] = useState(() => serviceTime()); const [loadedDate, setLoadedDate] = useState<string | null>(null); const [refreshKey, setRefreshKey] = useState(0); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState('');
 const dashboardPageRef = useRef<HTMLDivElement>(null); const [loadingMinHeight, setLoadingMinHeight] = useState<number | null>(storedDashboardHeight)
 const [roster, setRoster] = useState<RosterEntry[]>([]); const [bookings, setBookings] = useState<BookingRecord[]>([])
 const [trainingSessions, setTrainingSessions] = useState<TrainingSession[]>([])
 const [report, setReport] = useState<OperationalReport | null>(null); const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([])
 useEffect(() => { const dateTimer = window.setInterval(() => setDashboardDate(current => { const next = serviceDate(); return next === current ? current : next }), 60_000); const timeTimer = window.setInterval(() => setDashboardTime(serviceTime()), 60_000); return () => { window.clearInterval(dateTimer); window.clearInterval(timeTimer) } }, []);
 useEffect(() => { let active = true; if (loadedDate !== null) { const height = dashboardPageRef.current?.getBoundingClientRect().height || 0; if (height > 0) { setLoadingMinHeight(Math.ceil(height)); storeDashboardHeight(height) } } setLoading(true); setLoadError(''); const run = async () => { const next = await loadDashboardPayload(dashboardDate); if (!active) return; setRoster(next.roster); setBookings(next.bookings); setReport(next.report); setMaintenanceRecords(next.maintenanceRecords); setTrainingSessions(next.trainingSessions); setLoadedDate(dashboardDate) }; void run().catch(loadFailure => { if (active) setLoadError(loadFailure instanceof Error ? loadFailure.message : 'Unable to refresh the dashboard.') }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [dashboardDate, refreshKey]);
 const duty = (value?: string | null) => dutyOptions.find(option => option.value === value); const team = buildTeamToday(staff, roster, dutyOptions); const { working, off, leave, unassigned } = team
 const dutyPillStyle = (value?: string | null) => { const configured = duty(value)?.color; const backgroundColor = /^#[0-9a-f]{6}$/i.test(configured || '') ? configured! : '#eef2f4'; return { backgroundColor, borderColor: backgroundColor, color: readableDutyText(backgroundColor) } }
 const dashboard = buildDashboardData(report); const serviceBoard = buildHostessServiceBoard(bookings, bookingStatuses, dashboardDate)
 const maintenanceStage = (record: MaintenanceRecord) => maintenanceStatuses.find(option => option.value === record.status)?.metadata?.maintenanceStage || 'open'
 const maintenanceFollowUp = maintenanceRecords.filter(record => maintenanceStage(record) !== 'completed').sort((left, right) => Number(right.priority === 'urgent') - Number(left.priority === 'urgent') || right.dateReported.localeCompare(left.dateReported))
 const dailyTraining = buildDailyTraining(trainingSessions, dashboardDate); const training = dailyTraining.session
 const hasCurrentData = loadedDate === dashboardDate
 useLayoutEffect(() => { if (!hasCurrentData) return; const height = dashboardPageRef.current?.getBoundingClientRect().height || 0; if (height > 0) storeDashboardHeight(height); setLoadingMinHeight(null) }, [hasCurrentData, staff.length, roster.length, bookings.length, maintenanceRecords.length, trainingSessions.length])
 useEffect(() => { if (!hasCurrentData || !dashboardPageRef.current || typeof ResizeObserver === 'undefined') return; const observer = new ResizeObserver(entries => { const height = entries[0]?.contentRect.height || 0; if (height > 0) storeDashboardHeight(height) }); observer.observe(dashboardPageRef.current); return () => observer.disconnect() }, [hasCurrentData])
 const trainingTime = training ? `${training.startTime || training.time}${training.endTime ? ` – ${training.endTime}` : ''}` : '—'
 const trainingStatus = training ? ({ scheduled: 'Scheduled', awaiting_confirmation: 'Awaiting confirmation', completed: 'Completed', cancelled: 'Cancelled' }[training.operationalStatus || 'scheduled']) : ''
 const hour = Number(dashboardTime.slice(0, 2)); const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
 return <div ref={dashboardPageRef} className="dashboard-page" style={!hasCurrentData && loadingMinHeight ? { minHeight: loadingMinHeight } : undefined}><section className="hero dashboard-hero"><div className="dashboard-hero-copy"><p className="eyebrow">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${dashboardDate}T00:00:00`)).toUpperCase()}</p><h2>{greeting}.</h2></div><div className="dashboard-manager"><strong>{userDisplayName.toUpperCase()}</strong><span>VENUE MANAGER</span></div></section>
 {loadError && <section className="panel dashboard-load-error error-state" role="alert"><div><b>Dashboard data could not be refreshed.</b><span>{loadError}</span></div><ActionButton icon="refresh" onClick={() => setRefreshKey(current => current + 1)}>Try again</ActionButton></section>}
 {loading && !hasCurrentData && <section className="panel inline-state" role="status"><p>Loading today’s dashboard…</p></section>}
 {hasCurrentData && <section className="dashboard-grid">
 <div className="dashboard-column dashboard-column-primary">
  <article className="panel dashboard-card team-card dashboard-order-team"><div className="panel-title"><div><p className="eyebrow">TEAM TODAY</p><h3>{team.totalStaff} active staff</h3></div><ActionButton compact icon="chevron-right" iconPosition="end" className="dashboard-card-action" onClick={onRoster}>View roster</ActionButton></div><div className="dashboard-metric-grid team-metrics" aria-label="Team Today summary"><div><span>Working</span><strong>{working.length}</strong></div><div><span>OFF</span><strong>{off.length}</strong></div><div><span>Leave</span><strong>{leave.length}</strong></div></div><div className="team-groups"><div className="team-duty-group"><div className="team-name-grid">{working.map(item => <span className="team-staff-pill" style={dutyPillStyle(item.entry?.dutyCode)} key={item.person.id}>{item.person.name}</span>)}{working.length === 0 && <span className="team-status-empty">None assigned</span>}</div></div><div className="team-secondary-groups"><section className="team-secondary-panel"><header><b>OFF</b><span>{off.length}</span></header><div className="team-status-list">{off.map(item => <p className="team-staff-pill team-staff-pill--status" style={dutyPillStyle(item.entry?.dutyCode)} key={item.person.id}><strong>{item.person.name}</strong><em>{dutyDisplayCode(duty(item.entry?.dutyCode)) || 'OFF'}</em></p>)}{off.length === 0 && <p className="team-status-empty">None</p>}</div></section><section className="team-secondary-panel"><header><b>ON LEAVE</b><span>{leave.length}</span></header><div className="team-status-list">{leave.map(item => <p className="team-staff-pill team-staff-pill--status" style={dutyPillStyle(item.entry?.dutyCode)} key={item.person.id}><strong>{item.person.name}</strong><em>{dutyDisplayCode(duty(item.entry?.dutyCode)) || 'LEAVE'}</em></p>)}{leave.length === 0 && <p className="team-status-empty">None</p>}</div></section></div>{unassigned.length > 0 && <div className="team-unassigned"><b>UNASSIGNED · {unassigned.length}</b><p>{unassigned.map(item => item.person.name).join(' · ')}</p></div>}</div></article>
  <article className="panel dashboard-card dashboard-order-occasions"><div className="panel-title"><div><p className="eyebrow">GUEST OCCASIONS</p><h3>{dashboard.occasions.total} occasions</h3></div><ActionButton compact icon="chevron-right" iconPosition="end" className="dashboard-card-action" onClick={onOccasions}>View occasions</ActionButton></div><div className="dashboard-badges">{dashboard.occasions.categories.map(item => <span className="dashboard-occasion-pill" style={dashboardOccasionStyle(item.key, occasionTypes)} key={item.key}>{item.label} <b>{item.count}</b></span>)}{dashboard.occasions.categories.length === 0 && <span>None recorded</span>}</div></article>
  <article className="panel dashboard-card attention-card dashboard-order-attention"><div className="panel-title"><div><p className="eyebrow">MAINTENANCE FOLLOW-UP</p><h3>{maintenanceFollowUp.length ? `${maintenanceFollowUp.length} unresolved issue${maintenanceFollowUp.length === 1 ? '' : 's'}` : 'ALL CLEAR'}</h3></div></div>{maintenanceFollowUp.length === 0 ? <p className="dashboard-muted">No unresolved maintenance issues.</p> : <div className="maintenance-followup-list">{maintenanceFollowUp.map(record => <button type="button" className={record.priority === 'urgent' ? 'urgent' : 'normal'} key={record.id} onClick={() => onMaintenance(record.id)} aria-label={`Open maintenance issue: ${record.issue}`}><span><b>{record.issue}</b><em>{record.priority === 'urgent' ? 'Urgent' : 'Normal'}</em></span><SvgIcon name="chevron-right" size={18}/></button>)}</div>}</article>
 </div>
 <div className="dashboard-column dashboard-column-secondary">
  <article className="panel dashboard-card metric-dashboard-card dashboard-order-bookings"><div className="panel-title"><div><p className="eyebrow">BOOKINGS</p><h3>Today’s reservations</h3></div><ActionButton compact icon="chevron-right" iconPosition="end" className="dashboard-card-action" onClick={onBookings}>View bookings</ActionButton></div><div className="dashboard-metric-grid" aria-label="Booking summary"><div><span>Total Covers</span><strong>{dashboard.bookings.totalCovers}</strong></div><div><span>Adults</span><strong>{dashboard.bookings.adults}</strong></div><div><span>Kids</span><strong>{dashboard.bookings.kids}</strong></div></div></article>
  <article className="panel dashboard-card metric-dashboard-card dashboard-order-service"><div className="panel-title"><div><p className="eyebrow">SERVICE PROGRESS</p><h3>Live cover status</h3></div><ActionButton compact icon="chevron-right" iconPosition="end" className="dashboard-card-action" onClick={onBookings}>View service</ActionButton></div><div className="dashboard-metric-grid" aria-label="Service progress summary"><div><span>Covers Arrived</span><strong>{dashboard.serviceProgress.arrivedCovers}</strong></div><div><span>Remaining Covers</span><strong>{dashboard.serviceProgress.remainingCovers}</strong></div><div><span>No-show Covers</span><strong>{dashboard.serviceProgress.noShowCovers}</strong></div></div></article>
  <article className="panel dashboard-card training-dashboard-card dashboard-order-training"><div className="panel-title"><div><p className="eyebrow">DAILY TRAINING</p><h3>{training?.title || 'No upcoming sessions'}</h3></div><ActionButton compact icon="chevron-right" iconPosition="end" className="dashboard-card-action" onClick={onTraining}>View training</ActionButton></div>{training ? <><p className="dashboard-training-date">{dailyTraining.mode === 'today' ? 'TODAY' : `NEXT SESSION · ${formatDate(training.date)}`}</p><dl className="dashboard-training-details"><div><dt>Time</dt><dd>{trainingTime}</dd></div><div><dt>Facilitator</dt><dd>{training.trainer || 'Not assigned'}</dd></div><div><dt>Status</dt><dd><span className={`training-status ${training.operationalStatus || 'scheduled'}`}>{trainingStatus}</span></dd></div></dl></> : <p className="dashboard-empty">No active Training sessions are scheduled.</p>}</article>
 </div>
<article className="panel dashboard-card tonight-card dashboard-order-tonight"><div className="panel-title"><div><p className="eyebrow">TONIGHT AT A GLANCE</p><h3>Live hostess service board</h3></div></div><div className="dashboard-metric-grid hostess-state-summary" aria-label="Tonight service summary"><div><span>Upcoming</span><strong>{serviceBoard.summary.upcomingParties}</strong></div><div className="arrived"><span>Arrived</span><strong>{serviceBoard.summary.arrivedParties}</strong></div><div className="noshow"><span>No-show</span><strong>{serviceBoard.summary.noShowParties}</strong></div></div>{serviceBoard.rows.length > 0 ? <><section className="next-arrivals" aria-label={serviceBoard.next.eyebrow}><div><p className="eyebrow">{serviceBoard.next.eyebrow}</p><strong>{serviceBoard.next.label}</strong></div>{serviceBoard.next.groups.length > 0 && <div className="next-arrival-groups">{serviceBoard.next.groups.map(group => <span key={group.size}><b>{group.size} Pax</b> × {group.count}</span>)}</div>}</section><div className="tonight-scroll-shell"><div className="tonight-scroll" tabIndex={0} role="region" aria-label="Party-size service board. Scroll horizontally to view all party sizes."><table className="tonight-table" style={{ minWidth: `${112 + serviceBoard.partySizes.length * 76}px` }}><colgroup><col className="tonight-time-column" />{serviceBoard.partySizes.map(size => <col className="tonight-party-column" key={size} />)}</colgroup><thead><tr><th>Time</th>{serviceBoard.partySizes.map(size => <th key={size}>{size} pax</th>)}</tr></thead><tbody>{serviceBoard.rows.map(row => <tr key={row.time} className={row.active ? 'current-service-slot' : undefined}><td>{row.label}</td>{serviceBoard.partySizes.map(size => <td key={size}>{row.counts[size] ? <span className="tonight-count-badge">{row.counts[size]}</span> : ''}</td>)}</tr>)}</tbody></table></div></div></> : <p className="tonight-zero">{serviceBoard.zeroMessage}</p>}</article>
 </section>}</div> }
function Attendance({ configuration, onToast }: { configuration: typeof config; onToast: (message: string) => void }) {
 const [view, setView] = useState<'Daily' | 'Weekly' | 'Monthly'>('Daily'); const [date, setDate] = useState(serviceDate()); const [records, setRecords] = useState<AttendanceRecord[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [staffFilter, setStaffFilter] = useState('all')
 const range = (): [string, string] => view === 'Daily' ? [date, date] : view === 'Weekly' ? weekRange(date) : monthRange(date)
 const load = async () => { setLoading(true); setError(''); try { const [start, end] = range(); setRecords(await operationsApi.attendance(start, end)) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load attendance.') } finally { setLoading(false) } }
 useEffect(() => { void load() }, [view, date])
 const update = (staffId: string, recordDate: string, field: 'actualDuty' | 'attendanceStatus' | 'notes', value: string) => setRecords(current => current.map(record => record.staffId === staffId && record.date === recordDate ? { ...record, [field]: value } : record))
 const save = async (record: AttendanceRecord) => { try { await operationsApi.saveAttendance(record); onToast(`${record.staff.name}'s attendance saved.`); await load() } catch (saveError) { onToast(saveError instanceof Error ? saveError.message : 'Unable to save attendance.') } }
 const visible = records.filter(record => staffFilter === 'all' || record.staffId === staffFilter); const exceptions = visible.filter(record => countsAsAttendanceException(record, configuration.attendanceStatuses))
 return <>
<section className="attendance-toolbar">
<div>
<button className={view === 'Daily' ? 'view active' : 'view'} onClick={() => setView('Daily')}>Daily</button>
<button className={view === 'Weekly' ? 'view active' : 'view'} onClick={() => setView('Weekly')}>Weekly</button>
<button className={view === 'Monthly' ? 'view active' : 'view'} onClick={() => setView('Monthly')}>Monthly</button>
</div>
<input aria-label="Attendance date" type="date" value={date} onChange={event => setDate(event.target.value)} />{view === 'Monthly' && <select aria-label="Monthly staff member" value={staffFilter} onChange={event => setStaffFilter(event.target.value)}>
<option value="all">All staff</option>{Array.from(new Map(records.map(record => [record.staffId, record.staff])).values()).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>}</section>
<section className="attendance-summary">
<article className="panel">
<span>Scheduled records</span>
<strong>{visible.length}</strong>
</article>
<article className="panel">
<span>Actual working</span>
<strong>{visible.filter(record => configuration.dutyCodes.find(code => code.value === record.actualDuty)?.metadata?.countsAsWorking).length}</strong>
</article>
<article className="panel exception">
<span>Attendance exceptions</span>
<strong>{exceptions.length}</strong>
</article>
<div>
<p>Scheduled duty comes directly from the Duty Roster. Attendance records preserve the actual result separately.</p>
</div>
</section>{loading && <section className="panel inline-state">
<p>Loading attendance records…</p>
</section>}{error && <section className="panel inline-state error-state">
<p>{error}</p>
<button className="secondary" onClick={() => void load()}>Try again</button>
</section>}{!loading && !error && <>
<section className="panel attendance-panel">
<div className="panel-title">
<div>
<p className="eyebrow">{view.toUpperCase()} ATTENDANCE</p>
<h3>Scheduled versus actual duty</h3>
</div>
<small>Changes are saved independently from the Duty Roster.</small>
</div>
<div className="attendance-table-wrap" tabIndex={0} aria-label="Attendance records table">
<table className="attendance-table">
<thead>
<tr>{view !== 'Daily' && <th>Date</th>}<th>Team member</th>
<th>Scheduled duty</th>
<th>Actual duty</th>
<th>Attendance status</th>
<th>Notes</th>
<th>
</th>
</tr>
</thead>
<tbody>{visible.map(record => { const scheduled = configuration.dutyCodes.find(code => code.value === record.scheduledDuty); const actual = configuration.dutyCodes.find(code => code.value === record.actualDuty); const status = configuration.attendanceStatuses.find(item => item.value === record.attendanceStatus); const historical = record.staff.employmentStatus !== 'active'; return <tr key={`${record.staffId}-${record.date}`} className={status?.metadata?.countsAsException ? 'attendance-exception' : ''}>{view !== 'Daily' && <td>{formatDate(record.date)}</td>}<td>
<b>{record.staff.name}</b>
<small>{record.staff.number} · {record.staff.position}{historical ? ' · Inactive' : ''}</small>
</td>
<td>
<span className="duty-chip" style={{background:scheduled?.color}}>{record.scheduledDuty || '—'}</span>
</td>
<td>
<select disabled={historical} value={record.actualDuty || ''} onChange={event => update(record.staffId, record.date, 'actualDuty', event.target.value)}>
<option value="">Not recorded</option>{configuration.dutyCodes.filter(code => code.active || code.value === record.actualDuty).map(code => <option value={code.value} key={code.id}>{code.value} · {code.label}{code.active ? '' : ' (Inactive)'}</option>)}</select>
</td>
<td>
<select disabled={historical} value={record.attendanceStatus || ''} onChange={event => update(record.staffId, record.date, 'attendanceStatus', event.target.value)}>
<option value="">Not recorded</option>{configuration.attendanceStatuses.filter(item => item.active || item.value === record.attendanceStatus).map(item => <option value={item.value} key={item.id}>{item.label}{item.active ? '' : ' (Inactive)'}</option>)}</select>{status && <span className="status-dot" style={{background:status.color}}>
</span>}</td>
<td>
<input disabled={historical} value={record.notes || ''} onChange={event => update(record.staffId, record.date, 'notes', event.target.value)} placeholder="Optional note" />
</td>
<td>
<button className="link" disabled={historical} onClick={() => { update(record.staffId, record.date, 'actualDuty', record.scheduledDuty || ''); update(record.staffId, record.date, 'attendanceStatus', 'worked_as_scheduled') }}>Mark scheduled</button>
<button className="primary compact" disabled={historical || !record.attendanceStatus} onClick={() => void save(record)}>Save</button>
</td>
</tr>})}</tbody>
</table>
</div>
</section>
<section className="panel exceptions">
<p className="eyebrow">ATTENDANCE EXCEPTIONS</p>
<h3>{exceptions.length ? `${exceptions.length} item${exceptions.length === 1 ? '' : 's'} require attention` : 'No attendance exceptions'}</h3>{exceptions.map(item => <div className="alert" key={`${item.staffId}-${item.date}`}>
<b>Exception</b>
<span>{item.staff.name}: {item.attendanceStatus?.replaceAll('_', ' ') || 'Different duty'}</span>
</div>)}</section>
</>}</>
}
function DutyRosterPage({ staff, dutyOptions, positions, onToast, onDirtyChange, onSaveDutyCode, onReorderDutyCodes, onRemoveDutyCode }: { staff: Staff[]; dutyOptions: ConfigOption[]; positions: ConfigOption[]; onToast: (message: string) => void; onDirtyChange: (dirty: boolean) => void; onSaveDutyCode: (option: ConfigOption) => Promise<void>; onReorderDutyCodes: (orderedIds: string[]) => Promise<void>; onRemoveDutyCode: (id: string) => Promise<void> }) {
 const [section, setSection] = useState<'roster' | 'duty-codes'>('roster')
 const [rosterDirty, setRosterDirty] = useState(false)
 const handleRosterDirty = useCallback((dirty: boolean) => { setRosterDirty(dirty); onDirtyChange(dirty) }, [onDirtyChange])
 const changeSection = (next: 'roster' | 'duty-codes') => { if (next !== section && rosterDirty && !window.confirm('You have unsaved Duty Roster changes. Discard them?')) return; setSection(next) }
 return <section className="duty-roster-page">
 <nav className="duty-roster-tabs" aria-label="Duty Roster sections"><button type="button" className={section === 'roster' ? 'selected' : ''} aria-pressed={section === 'roster'} onClick={() => changeSection('roster')}>Roster</button><button type="button" className={section === 'duty-codes' ? 'selected' : ''} aria-pressed={section === 'duty-codes'} onClick={() => changeSection('duty-codes')}>Duty Code Settings</button></nav>
 {section === 'roster' ? <Roster staff={staff} dutyOptions={dutyOptions} positions={positions} onToast={onToast} onDirtyChange={handleRosterDirty} /> : <DutyCodeManager options={dutyOptions} onSave={onSaveDutyCode} onReorder={onReorderDutyCodes} onRemove={onRemoveDutyCode} />}
 </section>
}
function Roster({ staff, dutyOptions, positions, onToast, onDirtyChange }: { staff: Staff[]; dutyOptions: ConfigOption[]; positions: ConfigOption[]; onToast: (message: string) => void; onDirtyChange: (dirty: boolean) => void }) {
 const [view, setView] = useState<'Weekly' | 'Monthly'>('Weekly'); const [anchor, setAnchor] = useState(serviceDate()); const [mobileDate, setMobileDate] = useState(serviceDate()); const [roster, setRoster] = useState<RosterEntry[]>([]); const [drafts, setDrafts] = useState<Record<string, string>>({}); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const savingRef = useRef(false); const [error, setError] = useState(''); const [saveError, setSaveError] = useState('')
 const [start, end] = view === 'Weekly' ? rosterWeekRange(anchor) : monthRange(anchor); const dates = useMemo(() => calendarDates(start, end), [start, end]); const today = serviceDate()
 const load = async () => { setLoading(true); setError(''); try { setRoster(await operationsApi.roster(start, end)) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load the duty roster.') } finally { setLoading(false) } }
 useEffect(() => { void load() }, [start, end])
 useEffect(() => { if (mobileDate < start || mobileDate > end) setMobileDate(start) }, [start, end, mobileDate])
 const draftCount = Object.keys(drafts).length
 useEffect(() => { onDirtyChange(draftCount > 0); return () => onDirtyChange(false) }, [draftCount, onDirtyChange])
 useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (!draftCount) return; event.preventDefault(); event.returnValue = '' }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [draftCount])
 const entryFor = (staffId: string, date: string) => roster.find(entry => entry.staffId === staffId && entry.date === date)
 const keyFor = (staffId: string, date: string) => `${staffId}|${date}`
 const selectedCode = (staffId: string, date: string) => Object.prototype.hasOwnProperty.call(drafts, keyFor(staffId, date)) ? drafts[keyFor(staffId, date)] : entryFor(staffId, date)?.dutyCode || ''
 const updateDraft = (staffId: string, date: string, dutyCode: string) => { const key = keyFor(staffId, date); const savedCode = entryFor(staffId, date)?.dutyCode || ''; setSaveError(''); setDrafts(current => { const next = { ...current }; if (dutyCode === savedCode) delete next[key]; else next[key] = dutyCode; return next }) }
 const discardDrafts = () => { setDrafts({}); setSaveError('') }
 const proceed = (action: () => void) => { if (draftCount && !window.confirm('You have unsaved Duty Roster changes. Continue and discard them?')) return; discardDrafts(); action() }
 const saveChanges = async () => { if (!draftCount || savingRef.current) return; savingRef.current = true; const changes: RosterBatchChange[] = Object.entries(drafts).map(([key, dutyCode]) => { const separator = key.lastIndexOf('|'); const staffId = key.slice(0, separator); const date = key.slice(separator + 1); return { staffId, date, dutyCode, expectedUpdatedAt: entryFor(staffId, date)?.updatedAt || null } }); setSaving(true); setSaveError(''); try { const result = await operationsApi.updateRosterBatch(changes); const saved = await operationsApi.roster(start, end); setRoster(saved); setDrafts({}); onToast(`${result.saved} Duty Roster ${result.saved === 1 ? 'change' : 'changes'} saved.`) } catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'Duty Roster changes could not be saved. Your edits are still available.') } finally { savingRef.current = false; setSaving(false) } }
 const visibleStaff = staff.filter(person => (person.assignmentEligible ?? person.employmentStatus === 'active') || roster.some(entry => entry.staffId === person.id)); const activeStaffIds = useMemo(() => new Set(staff.filter(person => person.assignmentEligible ?? person.employmentStatus === 'active').map(person => person.id)), [staff]); const dutyClassification = (dutyCode: string) => dutyOptions.find(item => item.value === dutyCode)?.metadata?.dutyClassification || 'other'; const countsAsWorking = (dutyCode: string) => Boolean(dutyOptions.find(item => item.value === dutyCode)?.metadata?.countsAsWorking); const coverage = useMemo(() => dates.map(date => { const entries = roster.filter(entry => entry.date === date && activeStaffIds.has(entry.staffId)); return { working: entries.filter(entry => countsAsWorking(entry.dutyCode)).length, off: entries.filter(entry => dutyClassification(entry.dutyCode) === 'off').length, annualLeave: entries.filter(entry => dutyClassification(entry.dutyCode) === 'annualLeave').length } }), [dates, roster, dutyOptions, activeStaffIds]); const periodLabel = `${formatDate(start)} – ${formatDate(end)}`
 const shift = (direction: -1 | 1) => proceed(() => setAnchor(current => view === 'Weekly' ? addCalendarDays(current, direction * 7) : addCalendarMonths(current, direction)))
 const shiftMobileDay = (direction: -1 | 1) => proceed(() => { const next = addCalendarDays(mobileDate, direction); setMobileDate(next); if (next < start || next > end) setAnchor(next) })
 const exportPdf = async () => { if (draftCount) { setSaveError('Save or discard your unsaved changes before exporting. PDF export always uses the confirmed saved roster.'); return } try { const result = await shareOrDownloadRosterPdf({ view, start, end, dates, staff: visibleStaff, roster, dutyOptions }); if (result !== 'cancelled') onToast(result === 'shared' ? 'Saved Duty Roster shared.' : 'Saved Duty Roster PDF downloaded.') } catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'Duty Roster PDF could not be prepared.') } }
 return <>
<section className="toolbar roster-controls" aria-label="Duty roster period controls">
<div className="roster-period-tools">
<div className="roster-view-switch" role="group" aria-label="Roster view"><button type="button" className={view === 'Weekly' ? 'view active' : 'view'} aria-pressed={view === 'Weekly'} onClick={() => proceed(() => setView('Weekly'))}>Weekly</button>
<button type="button" className={view === 'Monthly' ? 'view active' : 'view'} aria-pressed={view === 'Monthly'} onClick={() => proceed(() => setView('Monthly'))}>Monthly</button></div>
<div className="roster-period-navigation"><IconAction icon="chevron-left" label={`Previous ${view}`} onClick={() => shift(-1)}/>
<ActionButton icon="calendar" className="roster-period-label" onClick={() => proceed(() => setAnchor(serviceDate()))}>{periodLabel}</ActionButton>
<IconAction icon="chevron-right" label={`Next ${view}`} onClick={() => shift(1)}/></div>
</div>
<div className="roster-actions">
<span className={draftCount ? 'unsaved-count active' : 'unsaved-count'} aria-live="polite">{draftCount ? `${draftCount} unsaved` : 'All changes saved'}</span>
<ActionButton icon="download" className="roster-export" disabled={saving} onClick={() => void exportPdf()}>Export PDF</ActionButton>
<ActionButton variant="primary" icon="save" className="roster-save" disabled={!draftCount || saving} onClick={() => void saveChanges()}>{saving ? 'Saving…' : 'Save Changes'}</ActionButton>
</div>
</section>{saveError && <div className="roster-save-feedback error-state" role="alert">{saveError}</div>}{loading && <section className="panel inline-state">
<p>Loading duty roster…</p>
</section>}{error && <section className="panel inline-state error-state">
<p>{error}</p>
<ActionButton icon="refresh" onClick={() => void load()}>Try again</ActionButton>
</section>}{!loading && !error && <section className={`panel roster-panel ${view.toLowerCase()}-view`} aria-label={`${view} duty roster`}>
<div className="roster-scroll" tabIndex={0} aria-label="Duty roster table">
<table className={`roster roster-${view.toLowerCase()}`}>
<thead>
<tr>
<th className="roster-member-header">Team member</th>{dates.map(date => { const rosterDate = new Date(`${date}T00:00:00`); return <th key={date} className={date === today ? 'today' : ''}>{view === 'Weekly' ? <div className="roster-compact-date" aria-label={new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(rosterDate)}><span className="roster-compact-weekday">{new Intl.DateTimeFormat('en-GB',{weekday:'short'}).format(rosterDate).toUpperCase()}</span><span className="roster-compact-date-line"><strong className="roster-compact-day">{new Intl.DateTimeFormat('en-GB',{day:'numeric'}).format(rosterDate)}</strong><span className="roster-compact-month">{new Intl.DateTimeFormat('en-GB',{month:'short'}).format(rosterDate).toUpperCase()}</span></span></div> : <><span className="roster-weekday">{new Intl.DateTimeFormat('en-GB',{weekday:'long'}).format(rosterDate)}</span><small>{new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(rosterDate)}{date === today ? ' · Today' : ''}</small></>}
</th>})}<th className="roster-working-header">Working days</th>
</tr>
</thead>
<tbody>{visibleStaff.map(person => { const rows = roster.filter(entry => entry.staffId === person.id); const inactive = !(person.assignmentEligible ?? person.employmentStatus === 'active'); return <tr key={person.id} className={inactive ? 'historical-row' : ''}>
<td className="roster-member-cell">
<b>{person.name}</b>
<small>{designationLabel(person.position, positions)} · {person.number}{inactive ? ' · Inactive' : ''}</small>
</td>{dates.map(date => { const entry = rows.find(row => row.date === date); const code = selectedCode(person.id, date); const option = dutyOptions.find(item => item.value === code); const available = dutyOptions.filter(item => item.value === entry?.dutyCode || item.active && !isLegacySickLeave(item)); const dutyTitle = option ? `${dutyDisplayCode(option)} · ${option.label}${option.metadata?.description ? ` — ${option.metadata.description}` : ''}${option.active ? '' : ' (Historical)'}` : 'Unassigned'; return <td key={date} className={`${date === today ? 'today-column ' : ''}${Object.prototype.hasOwnProperty.call(drafts, keyFor(person.id, date)) ? 'draft-cell' : ''}`.trim() || undefined}>
<select className={`duty-pill-select${option ? '' : ' no-assignment'}`} aria-label={`${person.name} duty ${date}`} title={dutyTitle} disabled={inactive || saving} value={code} style={{backgroundColor: option?.color,color:option ? readableDutyText(option.color) : undefined}} onChange={event => updateDraft(person.id, date, event.target.value)}>
<option value="">Unassigned</option>{available.map(item => <option key={item.id} value={item.value} aria-label={`${dutyDisplayCode(item)}, ${item.label}${item.active ? '' : ', historical'}`} title={item.metadata?.description || item.label}>{dutyDisplayCode(item)}</option>)}</select>
</td>})}<td className="roster-working-days">{rows.filter(row => countsAsWorking(row.dutyCode)).length}</td>
</tr>})}</tbody>
<tfoot>
<tr>
<td>Scheduled to Work</td>{coverage.map((item,index) => <td className={dates[index] === today ? 'today-column' : undefined} key={dates[index]}>{item.working}</td>)}<td>—</td>
</tr>
<tr className="coverage-secondary">
<td>OFF</td>{coverage.map((item,index) => <td className={dates[index] === today ? 'today-column' : undefined} key={dates[index]}>{item.off}</td>)}<td>—</td>
</tr>
<tr className="coverage-secondary">
<td>Annual Leave</td>{coverage.map((item,index) => <td className={dates[index] === today ? 'today-column' : undefined} key={dates[index]}>{item.annualLeave}</td>)}<td>—</td>
</tr>
</tfoot>
</table>
</div>
<div className="mobile-roster" aria-label={`Duty roster for ${formatDate(mobileDate)}`}>
<div className="mobile-day-navigation">
<IconAction icon="chevron-left" label="Previous roster day" onClick={() => shiftMobileDay(-1)}/>
<div>
<span>{new Intl.DateTimeFormat('en-GB',{weekday:'long'}).format(new Date(`${mobileDate}T00:00:00`))}</span>
<strong>{formatDate(mobileDate)}</strong>
</div>
<IconAction icon="chevron-right" label="Next roster day" onClick={() => shiftMobileDay(1)}/>
</div>
<div className="mobile-roster-list">{visibleStaff.map(person => { const entry = roster.find(item => item.staffId === person.id && item.date === mobileDate); const code = selectedCode(person.id, mobileDate); const option = dutyOptions.find(item => item.value === code); const inactive = !(person.assignmentEligible ?? person.employmentStatus === 'active'); const available = dutyOptions.filter(item => item.value === entry?.dutyCode || item.active && !isLegacySickLeave(item)); const drafted = Object.prototype.hasOwnProperty.call(drafts, keyFor(person.id, mobileDate)); return <article className={`${inactive ? 'mobile-roster-card historical-row' : 'mobile-roster-card'}${drafted ? ' draft-card' : ''}`} key={person.id}>
<div className="mobile-roster-identity">
<b>{person.name}</b>
<small>{person.number} · {designationLabel(person.position, positions)}{inactive ? ' · Inactive' : ''}</small>
</div>
<select className={option ? 'mobile-duty-select duty-pill-select' : 'mobile-duty-select duty-pill-select no-assignment'} aria-label={`${person.name} duty ${mobileDate}`} title={option ? `${dutyDisplayCode(option)} · ${option.label}${option.metadata?.description ? ` — ${option.metadata.description}` : ''}${option.active ? '' : ' (Historical)'}` : 'Unassigned'} disabled={inactive || saving} value={code} style={{backgroundColor:option?.color,color:option ? readableDutyText(option.color) : undefined}} onChange={event => updateDraft(person.id, mobileDate, event.target.value)}>
<option value="">Unassigned</option>{available.map(item => <option key={item.id} value={item.value} aria-label={`${dutyDisplayCode(item)}, ${item.label}${item.active ? '' : ', historical'}`} title={item.metadata?.description || item.label}>{dutyDisplayCode(item)} · {item.label}</option>)}</select>
</article>})}</div>
</div>
</section>}
</>
}
type LeavePlannerSection = 'planner' | 'history' | 'leave-types' | 'entitlement-policies' | 'employee-entitlements' | 'public-holidays'
function LeavePlannerWorkspace({ staff, configuration, onActivateDutyCode, initialView, initialStaffId }: { staff: Staff[]; configuration: typeof config; onActivateDutyCode: (code: string) => Promise<void>; initialView?: 'planner' | 'history'; initialStaffId?: string }) {
 const [section, setSection] = useState<LeavePlannerSection>(initialView || 'planner')
 useEffect(() => { if (initialView) setSection(initialView) }, [initialView, initialStaffId])
 const tabs = [
  { id: 'planner' as const, label: 'Planner' },
  { id: 'history' as const, label: 'Leave History' },
  { id: 'leave-types' as const, label: 'Leave Types' },
  { id: 'entitlement-policies' as const, label: 'Entitlement Policies' },
  { id: 'employee-entitlements' as const, label: 'Employee Entitlements' },
  { id: 'public-holidays' as const, label: 'Public Holiday Calendar' }
 ]
 return <section className="leave-planner-workspace">
  <nav className="leave-planner-module-tabs" aria-label="Leave Planner sections">{tabs.map(tab => <button type="button" key={tab.id} className={section === tab.id ? 'active' : ''} aria-current={section === tab.id ? 'page' : undefined} onClick={() => setSection(tab.id)}>{tab.label}</button>)}</nav>
  <div className="leave-planner-module-content">
   {(section === 'planner' || section === 'history') && <LeavePlannerPanel staff={staff} dutyOptions={configuration.dutyCodes} initialStaffId={section === 'history' ? initialStaffId : undefined} view={section} hideTabs />}
   {section === 'leave-types' && <LeaveTypesPanel dutyCodes={configuration.dutyCodes} onActivate={onActivateDutyCode} />}
   {section === 'entitlement-policies' && <EntitlementPoliciesPanel />}
   {section === 'employee-entitlements' && <StaffEntitlementsManager />}
   {section === 'public-holidays' && <PublicHolidaySettingsManager />}
  </div>
 </section>
}
function DutyCodeManager({ options, onSave, onReorder, onRemove }: { options: ConfigOption[]; onSave: (option: ConfigOption) => Promise<void>; onReorder: (orderedIds: string[]) => Promise<void>; onRemove: (id: string) => Promise<void> }) {
 const activeFromProps = options.filter(option => option.active); const [editing, setEditing] = useState<ConfigOption | null>(null); const [error, setError] = useState(''); const [ordered, setOrdered] = useState(activeFromProps); const [draggingId, setDraggingId] = useState<string | null>(null); const [savingOrder, setSavingOrder] = useState(false)
 const orderRef = useRef(ordered); const savingOrderRef = useRef(false); const pointer = useRef<{ id: string; pointerId: number; startX: number; startY: number; activated: boolean; timer: number } | null>(null); const modalTrigger = useRef<HTMLElement | null>(null)
 useEffect(() => { if (!draggingId && !savingOrderRef.current) { setOrdered(activeFromProps); orderRef.current = activeFromProps } }, [options])
 useEffect(() => { orderRef.current = ordered }, [ordered])
 const activeOptions = ordered
 const previewMove = (targetId: string, placement: DutyCodeDropPlacement) => { const active = draggingId || pointer.current?.id; if (!active || active === targetId) return; setOrdered(current => { const next = moveDutyCode(current, active, targetId, placement); orderRef.current = next; return next }) }
 const persist = async (next = orderRef.current) => { if (savingOrderRef.current) return; const requested = [...next]; savingOrderRef.current = true; setSavingOrder(true); setDraggingId(null); try { setError(''); await onReorder(requested.map(option => option.id)); setOrdered(requested); orderRef.current = requested } catch (moveError) { setOrdered(activeFromProps); orderRef.current = activeFromProps; setError(moveError instanceof Error ? moveError.message : 'Unable to save the new Duty Code order. The last saved order has been restored.') } finally { savingOrderRef.current = false; setSavingOrder(false) } }
 const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => { if (savingOrderRef.current) return; event.stopPropagation(); const handle = event.currentTarget; const capture = () => { try { handle.setPointerCapture(event.pointerId) } catch { /* Synthetic accessibility tests may not own a native pointer. */ } }; const state = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, activated: event.pointerType === 'mouse', timer: 0 }; pointer.current = state; if (state.activated) { event.preventDefault(); capture(); setDraggingId(id) } else state.timer = window.setTimeout(() => { state.activated = true; capture(); setDraggingId(id) }, 450) }
 const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => { const state = pointer.current; if (!state || state.pointerId !== event.pointerId) return; if (!state.activated && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 8) { window.clearTimeout(state.timer); pointer.current = null; return } if (!state.activated) return; event.preventDefault(); const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-duty-code-id]'); if (row?.dataset.dutyCodeId) { const bounds = row.getBoundingClientRect(); previewMove(row.dataset.dutyCodeId, event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after') } }
 const pointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => { const state = pointer.current; if (!state || state.pointerId !== event.pointerId) return; window.clearTimeout(state.timer); pointer.current = null; if (state.activated) { event.preventDefault(); void persist() } }
 const pointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => { const state = pointer.current; if (!state || state.pointerId !== event.pointerId) return; window.clearTimeout(state.timer); pointer.current = null; setDraggingId(null); setOrdered(activeFromProps); orderRef.current = activeFromProps }
 const keyboardMove = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => { if (!['ArrowUp', 'ArrowDown'].includes(event.key) || savingOrderRef.current) return; event.preventDefault(); const index = ordered.findIndex(option => option.id === id); const target = event.key === 'ArrowUp' ? index - 1 : index + 1; if (target < 0 || target >= ordered.length) return; const next = moveDutyCode(ordered, id, ordered[target].id, event.key === 'ArrowUp' ? 'before' : 'after'); setOrdered(next); orderRef.current = next; void persist(next) }
 const remove = async (option: ConfigOption) => { if (!window.confirm(`Remove ${dutyDisplayCode(option)} · ${option.label}? Historical assignments will remain available.`)) return; try { setError(''); await onRemove(option.id) } catch (removeError) { setError(removeError instanceof Error ? removeError.message : 'Unable to remove the Duty Code.') } }
 const openEditor = (option: ConfigOption, trigger: HTMLElement) => { modalTrigger.current = trigger; setEditing(option) }
 const closeEditor = () => { setEditing(null); window.requestAnimationFrame(() => modalTrigger.current?.focus()) }
 return <article className="panel duty-code-manager">
 <div className="panel-title"><div><p className="eyebrow">ROSTER CONFIGURATION</p><h3>Duty Codes</h3></div><ActionButton variant="primary" icon="add" onClick={event => openEditor({ id: crypto.randomUUID(), value: '', label: '', color: '#1b6288', active: true, metadata: { displayCode: '', countsAsWorking: true, dutyClassification: 'working' } }, event.currentTarget)}>Add Duty Code</ActionButton></div>
 <div className="duty-code-table-wrap" tabIndex={0} aria-label="Duty Code configuration table"><table className="duty-code-table"><thead><tr><th>Reorder</th><th>Code</th><th>Duty Name</th><th>Color</th><th>Preview</th><th>Counts as Working</th><th>Bill Tip Rule</th><th>Actions</th></tr></thead>
<tbody>{activeOptions.map(option => { const rule = dutyFinancialRuleView(option); return <tr className={draggingId === option.id ? 'is-dragging' : undefined} data-duty-code-id={option.id} key={option.id}><td><IconAction icon="grip" className="duty-drag-handle" disabled={savingOrder} label={`Reorder ${dutyDisplayCode(option)} · ${option.label}`} title="Drag to reorder; touch and hold on mobile; use Arrow Up or Arrow Down with the keyboard" onPointerDown={event => pointerDown(event, option.id)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerCancel} onKeyDown={event => keyboardMove(event, option.id)}/></td><td><b>{dutyDisplayCode(option)}</b>{option.metadata?.legacyCompatibility && <small>Historical compatibility</small>}</td><td className="duty-code-name">{option.label}</td><td><span className="duty-color-dot" style={{backgroundColor:option.color}} aria-label={option.color || 'No color'} /></td><td><span className="duty-code-preview" style={{backgroundColor:option.color,color:readableDutyText(option.color)}}>{dutyDisplayCode(option)}</span></td><td><StatusPill tone={option.metadata?.countsAsWorking ? 'success' : 'neutral'}>{option.metadata?.countsAsWorking ? 'Yes' : 'No'}</StatusPill></td><td><span className={typeof rule.eligible === 'boolean' ? 'duty-financial-rule configured' : 'duty-financial-rule required'}>{rule.label}</span></td><td><span className="duty-code-actions"><IconAction icon="edit" label={`Edit ${dutyDisplayCode(option)}`} onClick={event => openEditor(option, event.currentTarget)}/>{!option.metadata?.protected && <IconAction icon="trash" tone="danger" label={`Remove ${dutyDisplayCode(option)}`} onClick={() => void remove(option)}/>}</span></td></tr> })}</tbody></table></div>
 <div className="duty-code-card-list" aria-label="Duty Code configuration cards">{activeOptions.map(option => { const rule = dutyFinancialRuleView(option); return <article className={draggingId === option.id ? 'duty-code-card is-dragging' : 'duty-code-card'} data-duty-code-id={option.id} key={option.id}>
 <header><IconAction icon="grip" className="duty-drag-handle" disabled={savingOrder} label={`Reorder ${dutyDisplayCode(option)} · ${option.label}`} title="Touch and hold to reorder; use Arrow Up or Arrow Down with the keyboard" onPointerDown={event => pointerDown(event, option.id)} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerCancel} onKeyDown={event => keyboardMove(event, option.id)}/><div><b>{dutyDisplayCode(option)}</b><span>{option.label}</span></div><span className="duty-code-actions"><IconAction icon="edit" label={`Edit ${dutyDisplayCode(option)}`} onClick={event => openEditor(option, event.currentTarget)}/>{!option.metadata?.protected && <IconAction icon="trash" tone="danger" label={`Remove ${dutyDisplayCode(option)}`} onClick={() => void remove(option)}/>}</span></header>
 <div className="duty-code-card-preview"><span className="duty-color-dot" style={{backgroundColor:option.color}} aria-label={option.color || 'No color'} /><span className="duty-code-preview" style={{backgroundColor:option.color,color:readableDutyText(option.color)}}>{dutyDisplayCode(option)}</span><small>{option.color}</small></div>
 <dl><div><dt>Counts as Working</dt><dd><StatusPill tone={option.metadata?.countsAsWorking ? 'success' : 'neutral'}>{option.metadata?.countsAsWorking ? 'Yes' : 'No'}</StatusPill></dd></div><div><dt>Bill Tip Rule</dt><dd><span className={typeof rule.eligible === 'boolean' ? 'duty-financial-rule configured' : 'duty-financial-rule required'}>{rule.label}</span></dd></div></dl>
 </article> })}</div>
 {error && <p className="save-error" role="alert">{error}</p>}{editing && <DutyCodeForm option={editing} activeOptions={activeOptions} onClose={closeEditor} onSave={async option => { await onSave(option); closeEditor() }} />}
 </article>
}
function DutyCodeForm({ option, activeOptions, onClose, onSave }: { option: ConfigOption; activeOptions: ConfigOption[]; onClose: () => void; onSave: (option: ConfigOption) => Promise<void> }) {
 const initialForm = useMemo(() => { const initial = { ...option, metadata: { ...option.metadata, displayCode: dutyDisplayCode(option) } }; const units = initial.metadata.billTipWorkedDayUnits; if (!approvedDutyFinancialRule(initial) && initial.metadata.billTipEligible === true && units !== 0 && units !== 1) initial.metadata = { ...initial.metadata, billTipEligible: undefined }; return initial }, [option]); const [form, setForm] = useState<ConfigOption>(initialForm); const [error, setError] = useState(''); const classification = form.metadata?.dutyClassification || 'other'; const protectedIdentity = Boolean(form.metadata?.protected); const fixedWorking = classification === 'working' || isLeaveClassification(classification); const approvedFinancialRule = approvedDutyFinancialRule(form); const billTipEligible = approvedFinancialRule?.billTipEligible ?? form.metadata?.billTipEligible; const workedDayUnits = approvedFinancialRule?.workedDayUnits ?? form.metadata?.billTipWorkedDayUnits; const dirty = JSON.stringify(form) !== JSON.stringify(initialForm)
 const requestDismiss = useCallback(() => { if (dirty && !window.confirm('Discard unsaved Duty Code changes?')) return; onClose() }, [dirty, onClose])
 const submit = async (event: FormEvent) => { event.preventDefault(); const displayCode = form.metadata?.displayCode?.trim().toUpperCase() || ''; if (!displayCode || !form.label.trim() || !classification) return setError('Display Code, Duty Name and Duty Classification are required.'); const approvedCore = coreDutyCode(displayCode); if (!protectedIdentity && approvedCore) return setError(`${approvedCore.code} · ${approvedCore.label} is a protected core Duty Code. Use Activate Duty Code in Leave & Entitlements when it is unavailable.`); if (activeOptions.some(item => item.id !== form.id && dutyDisplayCode(item).toUpperCase() === displayCode)) return setError('That Display Code is already in use.'); if (!approvedFinancialRule && typeof billTipEligible !== 'boolean') return setError(`Choose whether ${displayCode} · ${form.label.trim()} is eligible for Bill Tips.`); if (!approvedFinancialRule && billTipEligible === true && workedDayUnits !== 0 && workedDayUnits !== 1) return setError(`Choose whether ${displayCode} · ${form.label.trim()} receives zero or one worked-day credit.`); try { await onSave({ ...form, label: form.label.trim(), metadata: { ...form.metadata, displayCode, dutyClassification: classification, countsAsWorking: classification === 'working' ? true : isLeaveClassification(classification) ? false : Boolean(form.metadata?.countsAsWorking), billTipEligible: approvedFinancialRule?.billTipEligible ?? billTipEligible, billTipWorkedDayUnits: approvedFinancialRule?.workedDayUnits ?? (billTipEligible === false ? 0 : workedDayUnits) } }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save the Duty Code.') } }
 const modalIdentity = protectedIdentity ? <div className="duty-code-modal-identity"><StatusPill tone="gold">Protected</StatusPill><b>{dutyDisplayCode(form)}</b><span>{form.label}</span></div> : undefined
 return <Modal title={option.value ? 'Edit Duty Code' : 'Add Duty Code'} className="duty-code-modal" wide headerContent={modalIdentity} onClose={requestDismiss} showClose={false} closeOnBackdrop closeOnEscape lockBackgroundScroll><form className="staff-form duty-code-form" onSubmit={event => void submit(event)}><div className="duty-code-form-fields">
 <label>Display Code<input required disabled={protectedIdentity} maxLength={12} value={form.metadata?.displayCode || ''} onChange={event => setForm({ ...form, metadata: { ...form.metadata, displayCode: event.target.value.toUpperCase() } })} placeholder="e.g. ON, AL, EL" /></label>
 <label>Duty Name<input required disabled={protectedIdentity} value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder="Descriptive duty name" /></label>
 <label>Color<div className="duty-color-control"><input type="color" value={form.color || '#1b6288'} onChange={event => setForm({ ...form, color: event.target.value })} /><input aria-label="Color hex value" maxLength={7} value={form.color || '#1b6288'} onChange={event => setForm({ ...form, color: event.target.value })} pattern="#[0-9A-Fa-f]{6}" /></div></label>
 <label>Duty Classification<select disabled={protectedIdentity} value={classification} onChange={event => { const next = event.target.value as NonNullable<ConfigOption['metadata']>['dutyClassification']; setForm({ ...form, metadata: { ...form.metadata, dutyClassification: next, countsAsWorking: next === 'working' ? true : isLeaveClassification(next) ? false : Boolean(form.metadata?.countsAsWorking) } }) }}><option value="working">Working Duty</option>{Object.entries(LEAVE_CLASSIFICATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="other">Other / Special Duty</option></select></label>
 <label>Counts as Working<select disabled={fixedWorking || protectedIdentity} value={form.metadata?.countsAsWorking ? 'yes' : 'no'} onChange={event => setForm({ ...form, metadata: { ...form.metadata, countsAsWorking: event.target.value === 'yes' } })}><option value="yes">Yes</option><option value="no">No</option></select><small>{isLeaveClassification(classification) ? 'Approved leave/status classifications cannot count as working.' : classification === 'working' ? 'Working Duty always counts as working.' : 'Controls Working Days and Scheduled-to-Work totals.'}</small></label>
 <label>Bill Tip Eligibility<select disabled={Boolean(approvedFinancialRule)} value={typeof billTipEligible === 'boolean' ? billTipEligible ? 'eligible' : 'not-eligible' : ''} onChange={event => { const eligible = event.target.value === '' ? undefined : event.target.value === 'eligible'; setForm({ ...form, metadata: { ...form.metadata, billTipEligible: eligible, billTipWorkedDayUnits: eligible === false ? 0 : form.metadata?.billTipWorkedDayUnits } }) }}><option value="">Decision required</option><option value="eligible">Eligible for Bill Tips</option><option value="not-eligible">Not eligible for Bill Tips</option></select><small>{approvedFinancialRule?.explanation || 'Manager decision for Bill Tip distribution.'}</small></label>
 <label>Worked-Day Credit<select disabled={Boolean(approvedFinancialRule) || billTipEligible !== true} value={workedDayUnits === 0 || workedDayUnits === 1 ? String(workedDayUnits) : ''} onChange={event => setForm({ ...form, metadata: { ...form.metadata, billTipWorkedDayUnits: event.target.value === '' ? undefined : Number(event.target.value) } })}><option value="">Decision required</option><option value="1">1 day</option><option value="0">0 days</option></select><small>{billTipEligible === false ? 'Not eligible codes always receive zero worked-day credit.' : 'Choose how this code contributes to the monthly Bill Tip share.'}</small></label>
 {protectedIdentity && <p className="protected-config-note">Code identity and meaning are protected. Color, display order and manager-required Bill Tip rules remain configurable.</p>}
 <div className="duty-live-preview"><span>Preview</span><b style={{backgroundColor:form.color,color:readableDutyText(form.color)}}>{form.metadata?.displayCode?.trim() || 'CODE'}</b><small>{form.label || 'Duty Name'}</small></div>
 {error && <p className="save-error" role="alert">{error}</p>}</div><div className="form-actions"><ActionButton onClick={requestDismiss}>Cancel</ActionButton><ActionButton variant="primary" icon="save" type="submit">Save Duty Code</ActionButton></div>
 </form></Modal>
}
function ComingSoon({ page }: { page: string }) { return <section className="empty panel">
<div className="empty-icon">◇</div>
<p className="eyebrow">FOUNDATION READY</p>
<h2>{page}</h2>
<p>This module is connected to the shared navigation, design system and configuration architecture. Its workflows are the next implementation increment.</p>
<button className="primary">Plan this module</button>
</section> }
function Modal({ title, children, onClose, wide = false, className = '', headerContent, showClose = true, closeOnBackdrop = false, closeOnEscape = false, lockBackgroundScroll = false }: { title:string; children:ReactNode; onClose:()=>void; wide?: boolean; className?: string; headerContent?: ReactNode; showClose?: boolean; closeOnBackdrop?: boolean; closeOnEscape?: boolean; lockBackgroundScroll?: boolean }) {
 const previousFocus = useRef<HTMLElement | null>(null); const onCloseRef = useRef(onClose)
 useEffect(() => { onCloseRef.current = onClose }, [onClose])
 useEffect(() => { previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; const previousOverflow = document.body.style.overflow; if (lockBackgroundScroll) document.body.style.overflow = 'hidden'; const keydown = (event: KeyboardEvent) => { if (closeOnEscape && event.key === 'Escape') { event.preventDefault(); onCloseRef.current() } }; document.addEventListener('keydown', keydown); return () => { document.removeEventListener('keydown', keydown); if (lockBackgroundScroll) document.body.style.overflow = previousOverflow; previousFocus.current?.focus() } }, [closeOnEscape, lockBackgroundScroll])
 return <div className="modal-backdrop" onPointerDown={event => { if (closeOnBackdrop && event.target === event.currentTarget) onClose() }}>
<section className={`modal${wide ? ' modal-wide' : ''} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
{showClose && <IconAction icon="close" className="close" label="Close dialog" onClick={onClose}/>} 
<h2>{title}</h2>{headerContent}{children}</section>
</div> }
function AttendanceStatusManager({ statuses, onSave }: { statuses: ConfigOption[]; onSave: (option: ConfigOption) => Promise<void> }) { const [editing, setEditing] = useState<ConfigOption | null>(null); return <section className="panel status-manager">
<div className="panel-title">
<div>
<p className="eyebrow">ATTENDANCE CONFIGURATION</p>
<h3>Attendance statuses</h3>
</div>
<button className="primary" onClick={() => setEditing({ id: crypto.randomUUID(), value: '', label: '', color: '#1b6288', active: true, metadata: { description: '', countsAsException: false } })}>Add Attendance Status</button>
</div>{statuses.map(status => <div className="status-manager-row" key={status.id}>
<span className="preview-badge" style={{background:status.color}}>{status.label}</span>
<span>{status.value}</span>
<span>{status.metadata?.countsAsException ? 'Exception' : 'Normal'}</span>
<span className={status.active ? 'badge blue' : 'badge'}>{status.active ? 'Active' : 'Inactive'}</span>
<button className="link" onClick={() => setEditing(status)}>Edit</button>
<button className="link" onClick={() => void onSave({ ...status, active: !status.active })}>{status.active ? 'Deactivate' : 'Activate'}</button>
</div>)}{editing && <AttendanceStatusForm status={editing} onClose={() => setEditing(null)} onSave={async status => { await onSave(status); setEditing(null) }} />}</section> }
function AttendanceStatusForm({ status, onClose, onSave }: { status: ConfigOption; onClose: () => void; onSave: (status: ConfigOption) => Promise<void> }) { const [form, setForm] = useState(status); const [error, setError] = useState(''); const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.value.trim() || !form.label.trim()) return setError('Status code and name are required.'); try { await onSave({ ...form, value: form.value.trim().toLowerCase().replaceAll(' ', '_') }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save status.') } }; return <Modal title={status.value ? 'Edit Attendance Status' : 'Add Attendance Status'} onClose={onClose}>
<form className="staff-form" onSubmit={event => void submit(event)}>
<label>Status code<input value={form.value} onChange={event => setForm({ ...form, value: event.target.value })} />
</label>
<label>Status name<input value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} />
</label>
<label>Description<input value={form.metadata?.description || ''} onChange={event => setForm({ ...form, metadata: { ...form.metadata, description: event.target.value } })} />
</label>
<label>Color<input type="color" value={form.color || '#1b6288'} onChange={event => setForm({ ...form, color: event.target.value })} />
</label>
<span className="preview-badge" style={{background:form.color}}>{form.label || 'Preview badge'}</span>
<label className="check-label">
<input type="checkbox" checked={Boolean(form.metadata?.countsAsException)} onChange={event => setForm({ ...form, metadata: { ...form.metadata, countsAsException: event.target.checked } })} /> Counts as an attendance exception</label>{error && <p className="save-error">{error}</p>}<div className="form-actions">
<button type="button" className="secondary" onClick={onClose}>Cancel</button>
<button className="primary" type="submit">Save status</button>
</div>
</form>
</Modal> }
export default App



