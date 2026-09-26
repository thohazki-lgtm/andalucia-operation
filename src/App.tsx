import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { bookingApi, chargeableApi, guestOccasionApi, maintenanceApi, operationsApi, reportingApi, staffApi, trainingApi } from './api'
import { config, type AttendanceRecord, type BookingRecord, type BookingSummary, type ConfigOption, type MaintenanceSummary, type OperationalReport, type RosterEntry, type Staff, type TrainingCustomization } from './domain'
import { StaffTrainingHistoryPanel, TrainingConfigurationManager } from './training'
import { TrainingR2Page as TrainingPage } from './training-r2'
import { BookingConfigurationManager, BookingsPage } from './bookings'
import { ChargeableConfigurationManager } from './chargeables'
import { IncentivesBillTipsPage } from './financial-preview'
import { GuestOccasionConfigurationManager, GuestOccasionsPage } from './guest-occasions'
import { MaintenanceConfigurationManager, MaintenancePage } from './maintenance'
import { ReportsPage } from './reports'
import { PublicHolidaySettingsManager, StaffEntitlementsManager } from './workforce'
import { addCalendarDays, addCalendarMonths, calendarDates, monthRange, serviceDate, weekRange } from './service-date'
import { requestWorkflow } from './workflow-intent'
import { StaffLeaveAvailability } from './staff-leave'
import { LeavePlannerPanel } from './leave-planner'
import { buildDashboardData, buildHostessServiceBoard, buildTeamToday } from './dashboard-data'
import { StaffMembershipBaselinePanel } from './staff-membership-baseline'
import { AuthUserButton, useAuth } from './auth'
import { DatabaseHealthPanel } from './database-health'

const navigation = [
 { label: 'Dashboard', icon: '⌂', eyebrow: 'OPERATIONS OVERVIEW' },
 { label: 'Staff Management', icon: '♙', eyebrow: 'TEAM DIRECTORY' },
 { label: 'Duty Roster', icon: '▦', eyebrow: 'WORKFORCE PLANNING' },
 { label: 'Training', icon: '✦', eyebrow: 'PEOPLE DEVELOPMENT' },
 { label: 'Bookings', icon: '▤', eyebrow: 'RESTAURANT RESERVATIONS' },
 { label: 'Guest Occasions', icon: '♡', eyebrow: 'GUEST EXPERIENCE' },
 { label: 'Incentives & Bill Tips', icon: '$', eyebrow: 'SERVICE REVENUE' },
 { label: 'Maintenance', icon: '⚒', eyebrow: 'OPERATIONS SUPPORT' },
 { label: 'Reports', icon: '▥', eyebrow: 'MANAGEMENT REPORTING' },
 { label: 'Customization Center', icon: '⚙', eyebrow: 'SYSTEM CONFIGURATION' }
] as const
const dutyDisplayCode = (option?: ConfigOption) => option?.metadata?.displayCode?.trim() || option?.value || ''
const readableDutyText = (color?: string) => { const match = /^#([0-9a-f]{6})$/i.exec(color || ''); if (!match) return '#ffffff'; const value = Number.parseInt(match[1], 16); const red = value >> 16; const green = value >> 8 & 255; const blue = value & 255; return (red * 299 + green * 587 + blue * 114) / 1000 >= 150 ? '#173247' : '#ffffff' }
function App() {
 const { user } = useAuth()
 const [reportBooking, setReportBooking] = useState<{ id: string; date: string } | null>(null)
 const [trainingCustomization, setTrainingCustomization] = useState<TrainingCustomization>({ defaults: { durationMinutes: 30, trainerMode: 'venue_manager', trainerStaffId: null, location: 'Andalucía', categoryValue: null, participantSelection: 'eligible_staff' }, target: { id: '', versionNumber: 1, effectiveMonth: '2026-09-01', monthlyTargetMinutes: 3600, monthlyTargetHours: 60, perHeadTargetMinutes: 216, perHeadTargetHours: 3.6, participantCreditCapMinutes: 30, calculationPolicyVersion: 'training-credit-v1', approvedBy: '', approvedAt: '' }, workflow: [{ state: 'scheduled', label: 'Scheduled', color: '#2f8063', protected: true }, { state: 'awaiting_confirmation', label: 'Awaiting Confirmation', color: '#b38b3a', protected: true }, { state: 'completed', label: 'Completed', color: '#1b6288', protected: true }, { state: 'cancelled', label: 'Cancelled', color: '#a7b0ba', protected: true }] })
 const [page, setPage] = useState('Dashboard'); const [configuration, setConfiguration] = useState(config); const [staff, setStaff] = useState<Staff[]>([]); const [staffLoading, setStaffLoading] = useState(true); const [staffError, setStaffError] = useState(''); const [toast, setToast] = useState(''); const [showStaff, setShowStaff] = useState(false); const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false); const [reportHeaderDate, setReportHeaderDate] = useState(formatDate(serviceDate()))
 const loadStaff = async () => { setStaffLoading(true); setStaffError(''); try { setStaff(await staffApi.list()) } catch (error) { setStaffError(error instanceof Error ? error.message : 'Unable to load staff records.') } finally { setStaffLoading(false) } }
 useEffect(() => { void loadStaff(); void operationsApi.attendanceStatuses().then(statuses => setConfiguration(current => ({ ...current, attendanceStatuses: statuses }))).catch(() => setToast('Unable to load attendance statuses.')); void staffApi.configuration().then(staffConfiguration => setConfiguration(current => ({ ...current, ...staffConfiguration }))).catch(() => setToast('Unable to load staff configuration.')) }, [])
 const applyTrainingConfiguration = (training: Awaited<ReturnType<typeof trainingApi.configuration>>) => { setConfiguration(current => ({ ...current, trainingCategories: training.categories, trainingStatuses: training.statuses, trainingAttendanceStatuses: training.attendanceStatuses })); setTrainingCustomization(current => ({ defaults: training.defaults || current.defaults, target: training.target || current.target, workflow: training.workflow || current.workflow })) }
 useEffect(() => { void trainingApi.configuration().then(applyTrainingConfiguration).catch(() => setToast('Unable to load training configuration.')) }, [])
 useEffect(() => { void bookingApi.configuration().then(booking => setConfiguration(current => ({ ...current, bookingStatuses: booking.statuses, bookingSources: booking.sources, restaurantTables: booking.tables, restaurantTableRanges: booking.tableRanges, bookingWalkInFields: booking.walkInFields }))).catch(() => setToast('Unable to load booking configuration.')) }, [])
 useEffect(() => { void chargeableApi.configuration().then(chargeable => setConfiguration(current => ({ ...current, chargeableItems: chargeable.items, chargeableStatuses: chargeable.statuses, wineSpiritCatalog: chargeable.wineCatalog ?? [] }))).catch(() => setToast('Unable to load chargeable configuration.')) }, [])
 useEffect(() => { void guestOccasionApi.configuration().then(occasion => setConfiguration(current => ({ ...current, occasionTypes: occasion.types, occasionStatuses: occasion.statuses }))).catch(() => setToast('Unable to load guest occasion configuration.')) }, [])
 useEffect(() => { void maintenanceApi.configuration().then(maintenance => setConfiguration(current => ({ ...current, maintenanceAreas: maintenance.areas, maintenanceStatuses: maintenance.statuses }))).catch(() => setToast('Unable to load maintenance configuration.')) }, [])
 useEffect(() => { if (!mobileNavigationOpen) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileNavigationOpen(false) }; document.addEventListener('keydown', closeOnEscape); return () => document.removeEventListener('keydown', closeOnEscape) }, [mobileNavigationOpen])
 const dutyOptions = configuration.dutyCodes
 const saveStaffConfiguration = async (group: 'duty-codes' | 'employment-statuses' | 'positions', option: ConfigOption) => { const prepared = group === 'duty-codes' && !option.value ? { ...option, value: `DUTY_${crypto.randomUUID().replaceAll('-', '').toUpperCase()}` } : option; const saved = await staffApi.saveConfiguration(group, prepared); const configGroup = group === 'duty-codes' ? 'dutyCodes' : group === 'employment-statuses' ? 'employmentStatuses' : 'positions'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })); if (group !== 'duty-codes') setToast('Staff configuration saved.') }
 const reorderDutyCode = async (id: string, direction: 'up' | 'down') => { const previous = configuration.dutyCodes; const active = previous.filter(item => item.active); const index = active.findIndex(item => item.id === id); const target = direction === 'up' ? index - 1 : index + 1; if (index < 0 || target < 0 || target >= active.length) return; const neighbourId = active[target].id; const optimistic = [...previous]; const sourceIndex = optimistic.findIndex(item => item.id === id); const targetIndex = optimistic.findIndex(item => item.id === neighbourId); [optimistic[sourceIndex], optimistic[targetIndex]] = [optimistic[targetIndex], optimistic[sourceIndex]]; setConfiguration(current => ({ ...current, dutyCodes: optimistic })); try { const dutyCodes = await staffApi.reorderDutyCode(id, direction); setConfiguration(current => ({ ...current, dutyCodes })) } catch (error) { setConfiguration(current => ({ ...current, dutyCodes: previous })); throw error } }
 const removeDutyCode = async (id: string) => { const result = await staffApi.removeDutyCode(id); setConfiguration(current => ({ ...current, dutyCodes: result.mode === 'deleted' ? current.dutyCodes.filter(item => item.id !== id) : current.dutyCodes.map(item => item.id === id && result.option ? result.option : item) })) }
 const saveBookingConfiguration = async (group: 'statuses' | 'sources' | 'tables' | 'tableRanges' | 'walkInFields', option: ConfigOption) => { const saved = await bookingApi.saveConfiguration(group, option); if (group === 'tableRanges') { const booking = await bookingApi.configuration(); setConfiguration(current => ({ ...current, restaurantTables: booking.tables, restaurantTableRanges: booking.tableRanges })); return } const configGroup = group === 'statuses' ? 'bookingStatuses' : group === 'sources' ? 'bookingSources' : group === 'tables' ? 'restaurantTables' : 'bookingWalkInFields'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })) }
 const resetWalkInConfiguration = async () => { const fields = await bookingApi.resetWalkInFields(); setConfiguration(current => ({ ...current, bookingWalkInFields: fields })) }
 const saveChargeableConfiguration = async (group: 'items' | 'statuses' | 'wine-catalog', option: ConfigOption) => { const saved = await chargeableApi.saveConfiguration(group, option); const configGroup = group === 'items' ? 'chargeableItems' : group === 'statuses' ? 'chargeableStatuses' : 'wineSpiritCatalog'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })); setToast('Commercial configuration saved.') }
 const saveGuestOccasionConfiguration = async (group: 'types' | 'statuses', option: ConfigOption) => { const saved = await guestOccasionApi.saveConfiguration(group, option); const configGroup = group === 'types' ? 'occasionTypes' : 'occasionStatuses'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })); setToast('Guest occasion configuration saved.') }
 const saveMaintenanceConfiguration = async (group: 'areas' | 'statuses', option: ConfigOption) => { const saved = await maintenanceApi.saveConfiguration(group, option); const configGroup = group === 'areas' ? 'maintenanceAreas' : 'maintenanceStatuses'; setConfiguration(current => ({ ...current, [configGroup]: current[configGroup].some(item => item.id === saved.id) ? current[configGroup].map(item => item.id === saved.id ? saved : item) : [...current[configGroup], saved] })); setToast('Maintenance configuration saved.') }
 const updateStaff = async (record: Staff) => { const existing = staff.some(item => item.id === record.id); const saved = existing ? await staffApi.update(record) : await staffApi.create(record); setStaff(current => current.some(item => item.id === saved.id) ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved]); setToast(`${saved.name} saved. Changes persist in the staff data store.`) }
 const navigate = (destination: string) => { setPage(destination); setMobileNavigationOpen(false) }
 const pageContext = navigation.find(item => item.label === page)?.eyebrow || 'OPERATIONS'
 return <div className="app-shell">
{mobileNavigationOpen && <button className="navigation-backdrop" aria-label="Close navigation menu" onClick={() => setMobileNavigationOpen(false)} />}
<aside id="application-navigation" className={`app-sidebar${mobileNavigationOpen ? ' mobile-open' : ''}`}>
<div className="brand">
<span>Á</span>
<div>ANDALUCÍA<small>OPERATION</small>
</div>
<button className="drawer-close" aria-label="Close navigation menu" title="Close navigation menu" onClick={() => setMobileNavigationOpen(false)}>×</button>
</div>
<nav aria-label="Application modules">{navigation.map(item => <button key={item.label} type="button" aria-current={page === item.label ? 'page' : undefined} aria-label={item.label} title={item.label} onClick={() => navigate(item.label)} className={page === item.label ? 'selected' : ''}>
<span className="nav-icon" aria-hidden="true">{item.icon}</span>
<span className="nav-label">{item.label}</span>
</button>)}</nav>
<div className="sidebar-footer">Siyam World Maldives<br/>
<small>Venue operations</small>
</div>
</aside>
<main>
<div className="mobile-topbar">
<button className="menu-button" type="button" aria-label="Open navigation menu" title="Open navigation menu" aria-expanded={mobileNavigationOpen} aria-controls="application-navigation" onClick={() => setMobileNavigationOpen(true)}>☰</button>
<div className="mobile-brand">
<span>Á</span>
<b>ANDALUCÍA <small>OPERATION</small>
</b>
</div>
<AuthUserButton />
</div>
<header className={`page-header${page === 'Reports' ? ' reports-header' : ''}`}>
<div>
<p className="eyebrow">{pageContext}</p>
<h1>{page}</h1>
</div>
<div className="header-actions">{page === 'Reports' && <span className="report-header-date">{reportHeaderDate}</span>}<AuthUserButton />
</div>
</header>
{toast && <div className="toast" role="status" aria-live="polite">{toast}<button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}>×</button>
</div>}
{page === 'Dashboard' && <Dashboard userDisplayName={user.displayName} staff={staff} dutyOptions={dutyOptions} bookingStatuses={configuration.bookingStatuses} onRoster={() => setPage('Duty Roster')} onBookings={() => setPage('Bookings')} onOccasions={() => setPage('Guest Occasions')} onChargeables={() => setPage('Incentives & Bill Tips')} onMaintenance={() => setPage('Maintenance')} />}
{page === 'Staff Management' && <StaffManagement staff={staff} configuration={configuration} loading={staffLoading} error={staffError} onRetry={loadStaff} onSave={updateStaff} onToast={setToast} />}
{page === 'Duty Roster' && <Roster staff={staff} dutyOptions={dutyOptions} onToast={setToast} />}
{page === 'Training' && <TrainingPage staff={staff} configuration={{ categories: configuration.trainingCategories, statuses: configuration.trainingStatuses, attendanceStatuses: configuration.trainingAttendanceStatuses, ...trainingCustomization }} onToast={setToast} />}
{page === 'Bookings' && <BookingsPage staff={staff} configuration={{ statuses: configuration.bookingStatuses, sources: configuration.bookingSources, tables: configuration.restaurantTables, tableRanges: configuration.restaurantTableRanges, walkInFields: configuration.bookingWalkInFields, occasionTypes: configuration.occasionTypes }} onToast={setToast} initialBooking={reportBooking} />}
{page === 'Guest Occasions' && <GuestOccasionsPage staff={staff} configuration={{ types: configuration.occasionTypes, statuses: configuration.occasionStatuses, tables: configuration.restaurantTables }} onToast={setToast} />}
{page === 'Incentives & Bill Tips' && <IncentivesBillTipsPage staff={staff} configuration={{ items: configuration.chargeableItems, statuses: configuration.chargeableStatuses, tables: configuration.restaurantTables }} onToast={setToast} />}
{page === 'Maintenance' && <MaintenancePage staff={staff} authenticatedStaffId={user.staffId} configuration={{ areas: configuration.maintenanceAreas, statuses: configuration.maintenanceStatuses }} onToast={setToast} />}
{page === 'Reports' && <ReportsPage onToast={setToast} onPeriodLabelChange={setReportHeaderDate} onOpenBooking={(id,date) => { setReportBooking({ id, date }); setPage('Bookings') }} />}
{page === 'Customization Center' && <CustomizationCenter configuration={configuration} trainingCustomization={trainingCustomization} staff={staff} onTrainingChanged={applyTrainingConfiguration} onSaveStaff={saveStaffConfiguration} onReorderDutyCode={reorderDutyCode} onRemoveDutyCode={removeDutyCode} onSaveBooking={saveBookingConfiguration} onResetWalkIn={resetWalkInConfiguration} onSaveChargeable={saveChargeableConfiguration} onSaveGuestOccasion={saveGuestOccasionConfiguration} onSaveMaintenance={saveMaintenanceConfiguration} />}
{!['Dashboard','Staff Management','Duty Roster','Training','Bookings','Guest Occasions','Incentives & Bill Tips','Maintenance','Reports','Customization Center'].includes(page) && <ComingSoon page={page} />}</main>{showStaff && <StaffForm title="Add staff member" configuration={configuration} onClose={() => setShowStaff(false)} onSave={async record => { await updateStaff(record); setShowStaff(false) }} />}</div>
}
type CustomizationCategory = 'workforce' | 'bookings' | 'training' | 'guest-experience' | 'commercial' | 'maintenance' | 'platform'
const customizationCategories: Array<{ id: CustomizationCategory; label: string }> = [
 { id: 'workforce', label: 'Workforce' },
 { id: 'bookings', label: 'Bookings' },
 { id: 'training', label: 'Training' },
 { id: 'guest-experience', label: 'Guest Experience' },
 { id: 'commercial', label: 'Commercial' },
 { id: 'maintenance', label: 'Maintenance' }
]
function CustomizationCenter({ configuration, trainingCustomization, staff, onTrainingChanged, onSaveStaff, onReorderDutyCode, onRemoveDutyCode, onSaveBooking, onResetWalkIn, onSaveChargeable, onSaveGuestOccasion, onSaveMaintenance }: { configuration: typeof config; trainingCustomization: TrainingCustomization; staff: Staff[]; onTrainingChanged: (training: Awaited<ReturnType<typeof trainingApi.configuration>>) => void; onSaveStaff: (group: StaffConfigurationGroup, option: ConfigOption) => Promise<void>; onReorderDutyCode: (id: string, direction: 'up' | 'down') => Promise<void>; onRemoveDutyCode: (id: string) => Promise<void>; onSaveBooking: (group: 'statuses' | 'sources' | 'tables' | 'tableRanges' | 'walkInFields', option: ConfigOption) => Promise<void>; onResetWalkIn: () => Promise<void>; onSaveChargeable: (group: 'items' | 'statuses' | 'wine-catalog', option: ConfigOption) => Promise<void>; onSaveGuestOccasion: (group: 'types' | 'statuses', option: ConfigOption) => Promise<void>; onSaveMaintenance: (group: 'areas' | 'statuses', option: ConfigOption) => Promise<void> }) {
 const { user } = useAuth()
 const [category, setCategory] = useState<CustomizationCategory>('workforce')
 const categories = user.isOwner ? [...customizationCategories, { id: 'platform' as const, label: 'Platform' }] : customizationCategories
 return <section className="customization-center">
 <nav className="customization-category-nav" aria-label="Customization categories">{categories.map(item => <button key={item.id} type="button" className={category === item.id ? 'selected' : ''} aria-current={category === item.id ? 'page' : undefined} onClick={() => setCategory(item.id)}>{item.label}</button>)}</nav>
 <div className="customization-category-panel" aria-label={`${categories.find(item => item.id === category)?.label} configuration`}>
 {category === 'workforce' && <ConfigurationView configuration={configuration} onSave={onSaveStaff} onReorderDutyCode={onReorderDutyCode} onRemoveDutyCode={onRemoveDutyCode} />}
 {category === 'bookings' && <BookingConfigurationManager configuration={{ statuses: configuration.bookingStatuses, sources: configuration.bookingSources, tables: configuration.restaurantTables, tableRanges: configuration.restaurantTableRanges, walkInFields: configuration.bookingWalkInFields }} onSave={onSaveBooking} onResetWalkIn={onResetWalkIn} />}
 {category === 'training' && <TrainingConfigurationManager staff={staff} configuration={{ categories: configuration.trainingCategories, statuses: configuration.trainingStatuses, attendanceStatuses: configuration.trainingAttendanceStatuses, ...trainingCustomization }} onChanged={onTrainingChanged} />}
 {category === 'guest-experience' && <GuestOccasionConfigurationManager configuration={{ types: configuration.occasionTypes, statuses: configuration.occasionStatuses }} onSave={onSaveGuestOccasion} />}
 {category === 'commercial' && <ChargeableConfigurationManager configuration={{ items: configuration.chargeableItems, statuses: configuration.chargeableStatuses, wineCatalog: configuration.wineSpiritCatalog }} onSave={onSaveChargeable} />}
 {category === 'maintenance' && <MaintenanceConfigurationManager configuration={{ areas: configuration.maintenanceAreas, statuses: configuration.maintenanceStatuses }} onSave={onSaveMaintenance} />}
 {category === 'platform' && user.isOwner && <DatabaseHealthPanel />}
 </div>
 </section>
}
function StaffManagement({ staff, configuration, loading, error, onRetry, onSave, onToast }: { staff: Staff[]; configuration: typeof config; loading: boolean; error: string; onRetry: () => Promise<void>; onSave: (staff: Staff) => Promise<void>; onToast: (message: string) => void }) {
 const [section, setSection] = useState<'directory' | 'leave' | 'membership'>('directory'); const [leaveStaffId, setLeaveStaffId] = useState<string>(); const [query, setQuery] = useState(''); const [position, setPosition] = useState('all'); const [employmentStatus, setEmploymentStatus] = useState('all'); const [sort, setSort] = useState<'name' | 'number' | 'joinDate'>('name'); const [editor, setEditor] = useState<Staff | 'new' | null>(null); const [viewer, setViewer] = useState<Staff | null>(null); const [todayRoster, setTodayRoster] = useState<RosterEntry[]>([])
 useEffect(() => { let current = true; void operationsApi.roster(serviceDate(), serviceDate()).then(records => { if (current) setTodayRoster(records) }).catch(() => { if (current) setTodayRoster([]) }); return () => { current = false } }, [staff])
 const statusOption = (value: string) => configuration.employmentStatuses.find(option => option.value === value)
 const dutyFor = (person: Staff) => todayRoster.find(entry => entry.staffId === person.id)
 const dutyOptionFor = (person: Staff) => configuration.dutyCodes.find(option => option.value === dutyFor(person)?.dutyCode)
 const visibleStaff = staff.filter(person => (position === 'all' || person.position === position) && (employmentStatus === 'all' || person.employmentStatus === employmentStatus) && `${person.name} ${person.number} ${person.position}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === 'number' ? a.number.localeCompare(b.number) : sort === 'joinDate' ? a.joinDate.localeCompare(b.joinDate) : a.name.localeCompare(b.name))
 const workingToday = new Set(staff.filter(person => dutyOptionFor(person)?.metadata?.countsAsWorking).map(person => person.id)).size
 const offToday = new Set(staff.filter(person => ['off', 'publicHoliday'].includes(dutyOptionFor(person)?.metadata?.dutyClassification || '')).map(person => person.id)).size
 const onLeave = new Set(staff.filter(person => ['annualLeave', 'sickLeave'].includes(dutyOptionFor(person)?.metadata?.dutyClassification || '')).map(person => person.id)).size
 const active = staff.filter(person => statusOption(person.employmentStatus)?.metadata?.employmentStage === 'active' || person.employmentStatus === 'active').length
 const inactive = staff.filter(person => statusOption(person.employmentStatus)?.metadata?.employmentStage === 'inactive' || ['inactive', 'resigned', 'transferred'].includes(person.employmentStatus)).length
 const archive = async (person: Staff) => { if (!window.confirm(`Archive ${person.name}? Historical roster and booking records will remain linked to this employee.`)) return; try { await onSave({ ...person, employmentStatus: 'inactive', resignationDate: person.resignationDate || serviceDate() }); setViewer(null); onToast(`${person.name} was archived. Historical operational records were preserved.`) } catch (saveError) { onToast(saveError instanceof Error ? saveError.message : 'Unable to archive staff member.') } }
 return <>{loading && <section className="panel inline-state">
<p>Loading staff records…</p>
</section>}{error && <section className="panel inline-state error-state">
<p>{error}</p>
<button className="secondary" onClick={() => void onRetry()}>Try again</button>
</section>}{!loading && !error && <>
<nav className="staff-section-tabs" aria-label="Staff Management sections"><button className={section === 'directory' ? 'selected' : ''} aria-pressed={section === 'directory'} onClick={() => setSection('directory')}>Team Directory</button><button className={section === 'leave' ? 'selected' : ''} aria-pressed={section === 'leave'} onClick={() => { setLeaveStaffId(undefined); setSection('leave') }}>Leave Planner</button><button className={section === 'membership' ? 'selected' : ''} aria-pressed={section === 'membership'} onClick={() => setSection('membership')}>Team Membership</button></nav>
{section === 'directory' && <>
<section className="staff-summary">
<article className="panel"><span>Total Staff</span><strong>{staff.length}</strong></article>
<article className="panel"><span>Active</span><strong>{active}</strong></article>
<article className="panel"><span>Working Today</span><strong>{workingToday}</strong></article>
<article className="panel"><span>Off Today</span><strong>{offToday}</strong></article>
<article className="panel"><span>On Leave</span><strong>{onLeave}</strong></article>
<article className="panel"><span>Inactive</span><strong>{inactive}</strong></article>
<div>
<button className="primary" onClick={() => setEditor('new')}>＋ Add Staff Member</button>
<p>Staff are shared across duties, attendance, training and service assignments.</p>
</div>
</section>
<section className="panel staff-panel">
<div className="staff-tools">
<input aria-label="Search staff" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search staff name or number" />
<select aria-label="Filter by position" value={position} onChange={event => setPosition(event.target.value)}>
<option value="all">All designations</option>{configuration.positions.filter(option => option.active).map(option => <option value={option.value} key={option.id}>{option.label}</option>)}</select>
<select aria-label="Filter by employment status" value={employmentStatus} onChange={event => setEmploymentStatus(event.target.value)}>
<option value="all">All employment statuses</option>{configuration.employmentStatuses.filter(option => option.active).map(option => <option value={option.value} key={option.id}>{option.label}</option>)}</select>
<select aria-label="Sort staff" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="name">Sort by name</option><option value="number">Sort by Employee ID</option><option value="joinDate">Sort by joining date</option></select>
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
<th aria-label="Actions">
</th>
</tr>
</thead>
<tbody>{visibleStaff.map(person => <tr key={person.id}>
<td><b>{person.name}</b></td>
<td>{person.number}</td>
<td>{person.position}</td>
<td>
<span className="badge staff-status" style={{ borderColor: statusOption(person.employmentStatus)?.color, color: statusOption(person.employmentStatus)?.color }}>{statusOption(person.employmentStatus)?.label || person.employmentStatus}</span>
</td>
<td><span className="today-duty" title={dutyOptionFor(person)?.label || 'No duty assigned'}>{dutyOptionFor(person) ? dutyDisplayCode(dutyOptionFor(person)) : 'Unassigned'}</span></td>
<td>{formatDate(person.joinDate)}</td>
<td className="row-actions">
<button className="link" onClick={() => setViewer(person)}>View Profile</button>
<button className="link" onClick={() => setEditor(person)}>Edit</button>
{person.assignmentEligible && <button className="link danger" onClick={() => void archive(person)}>Archive</button>}
</td>
</tr>)}</tbody>
</table>{visibleStaff.length === 0 && <div className="inline-empty">No staff records match the current search or filters.</div>}</div><div className="staff-mobile-cards">{visibleStaff.map(person => <article className="staff-mobile-card" key={person.id}><header><div><b>{person.name}</b><small>{person.number}</small></div><span className="badge staff-status" style={{ borderColor: statusOption(person.employmentStatus)?.color, color: statusOption(person.employmentStatus)?.color }}>{statusOption(person.employmentStatus)?.label || person.employmentStatus}</span></header><dl><div><dt>Designation</dt><dd>{person.position}</dd></div><div><dt>Today</dt><dd>{dutyOptionFor(person) ? dutyDisplayCode(dutyOptionFor(person)) : 'Unassigned'}</dd></div><div><dt>Joined</dt><dd>{formatDate(person.joinDate)}</dd></div></dl><div><button className="secondary" onClick={() => setViewer(person)}>View Profile</button><button className="secondary" onClick={() => setEditor(person)}>Edit</button>{person.assignmentEligible && <button className="link danger" onClick={() => void archive(person)}>Archive</button>}</div></article>)}</div>
</section>{editor && <StaffForm title={editor === 'new' ? 'Add Staff Member' : 'Edit Staff Member'} staff={editor === 'new' ? undefined : editor} configuration={configuration} onClose={() => setEditor(null)} onSave={async record => { await onSave(record); setEditor(null) }} />}{viewer && <StaffProfileDrawer staff={viewer} configuration={configuration} onClose={() => setViewer(null)} onEdit={() => { setEditor(viewer); setViewer(null) }} onArchive={() => void archive(viewer)} onViewLeaveHistory={() => { setLeaveStaffId(viewer.id); setViewer(null); setSection('leave') }} />}</>}{section === 'leave' && <LeavePlannerPanel staff={staff} initialStaffId={leaveStaffId} />}{section === 'membership' && <StaffMembershipBaselinePanel staff={staff} employmentStatuses={configuration.employmentStatuses} />}</>}</>
}
function StaffForm({ title, staff, configuration, onClose, onSave }: { title: string; staff?: Staff; configuration: typeof config; onClose: () => void; onSave: (staff: Staff) => Promise<void> }) {
 const [form, setForm] = useState<Staff>(staff || { id: crypto.randomUUID(), name: '', number: '', position: configuration.positions.find(option => option.active)?.value || '', nationality: '', division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía', identityDocumentNumber: '', employmentStatus: configuration.employmentStatuses.find(option => option.value === 'active' && option.active)?.value || configuration.employmentStatuses.find(option => option.active)?.value || '', joinDate: serviceDate() }); const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState('')
 const change = (field: keyof Staff, value: string) => setForm(current => ({ ...current, [field]: value }))
 const inactiveStage = configuration.employmentStatuses.find(option => option.value === form.employmentStatus)?.metadata?.employmentStage === 'inactive'
 const submit = async (event: FormEvent) => { event.preventDefault(); const nextErrors: Record<string, string> = {}; if (!form.number.trim()) nextErrors.number = 'Employee ID is required.'; if (!form.name.trim()) nextErrors.name = 'Name is required.'; if (!form.position) nextErrors.position = 'Designation is required.'; if (!form.employmentStatus) nextErrors.employmentStatus = 'Employment status is required.'; if (!form.joinDate || Number.isNaN(Date.parse(`${form.joinDate}T00:00:00Z`))) nextErrors.joinDate = 'A valid date of joining is required.'; if (form.resignationDate && form.joinDate && form.resignationDate < form.joinDate) nextErrors.resignationDate = 'Resignation date cannot be before the joining date.'; setErrors(nextErrors); if (Object.keys(nextErrors).length) return; setSaving(true); setSaveError(''); try { await onSave({ ...form, name: form.name.trim(), number: form.number.trim(), nationality: form.nationality.trim(), division: form.division.trim(), department: form.department.trim(), outlet: form.outlet.trim() || 'Andalucía', identityDocumentNumber: form.identityDocumentNumber.trim(), resignationDate: inactiveStage ? form.resignationDate : undefined }) } catch (error) { setSaveError(error instanceof Error ? error.message : 'Unable to save staff member.') } finally { setSaving(false) } }
 return <Modal title={title} onClose={onClose} wide>
<form className="staff-form staff-profile-form" onSubmit={event => void submit(event)}>
<label>Employee ID<input value={form.number} onChange={event => change('number', event.target.value)} placeholder="e.g. SW2330" />{errors.number && <small className="field-error">{errors.number}</small>}</label>
<label>Name<input value={form.name} onChange={event => change('name', event.target.value)} placeholder="e.g. Kapil" />{errors.name && <small className="field-error">{errors.name}</small>}</label>
<label>Designation<select value={form.position} onChange={event => change('position', event.target.value)}>
<option value="">Select a position</option>{configuration.positions.filter(option => option.active || option.value === form.position).map(option => <option key={option.id} value={option.value}>{option.label}{option.active ? '' : ' (Inactive)'}</option>)}</select>{errors.position && <small className="field-error">{errors.position}</small>}</label>
<label>Employment status<select value={form.employmentStatus} onChange={event => change('employmentStatus', event.target.value)}>
<option value="">Select a status</option>{configuration.employmentStatuses.filter(option => option.active || option.value === form.employmentStatus).map(option => <option key={option.id} value={option.value}>{option.label}{option.active ? '' : ' (Inactive)'}</option>)}</select>{errors.employmentStatus && <small className="field-error">{errors.employmentStatus}</small>}</label>
<label>Date of joining<input type="date" value={form.joinDate} onChange={event => change('joinDate', event.target.value)} />{errors.joinDate && <small className="field-error">{errors.joinDate}</small>}</label><label>Nationality<input value={form.nationality} onChange={event => change('nationality', event.target.value)} /></label><label>Division<input value={form.division} onChange={event => change('division', event.target.value)} /></label><label>Department<input value={form.department} onChange={event => change('department', event.target.value)} /></label><label>Outlet<input value={form.outlet} onChange={event => change('outlet', event.target.value)} /></label><label>ID / Passport No.<input value={form.identityDocumentNumber} onChange={event => change('identityDocumentNumber', event.target.value)} /></label>{inactiveStage && <label>Separation date<input type="date" value={form.resignationDate || ''} onChange={event => change('resignationDate', event.target.value)} />{errors.resignationDate && <small className="field-error">{errors.resignationDate}</small>}</label>}{saveError && <p className="save-error staff-form-error">{saveError}</p>}<div className="form-actions">
<button type="button" className="secondary" onClick={onClose}>Cancel</button>
<button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save staff member'}</button>
</div>
</form>
</Modal>
}
function StaffProfileDrawer({ staff, configuration, onClose, onEdit, onArchive, onViewLeaveHistory }: { staff: Staff; configuration: typeof config; onClose: () => void; onEdit: () => void; onArchive: () => void; onViewLeaveHistory: () => void }) {
 const status = configuration.employmentStatuses.find(option => option.value === staff.employmentStatus)
 const item = (label: string, value: string) => <div><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>
 return <div className="staff-profile-overlay"><aside className="staff-profile-drawer" role="dialog" aria-modal="true" aria-label={`Staff profile for ${staff.name}`}><button className="close" aria-label="Close staff profile" title="Close" onClick={onClose}>×</button><header><p className="eyebrow">STAFF PROFILE</p><h2>{staff.name}</h2><span>{staff.position}</span><b className="badge staff-status" style={{ borderColor: status?.color, color: status?.color }}>{status?.label || staff.employmentStatus}</b></header><section><p className="eyebrow">EMPLOYMENT INFORMATION</p><dl className="staff-profile-grid">{item('Name', staff.name)}{item('Employee ID', staff.number)}{item('Designation', staff.position)}{item('Date of Joining', formatDate(staff.joinDate))}{item('Nationality', staff.nationality)}{item('Division', staff.division)}{item('Department', staff.department)}{item('Outlet', staff.outlet || 'Andalucía')}{item('ID / Passport No.', staff.identityDocumentNumber)}{item('Employment Status', status?.label || staff.employmentStatus)}</dl></section><StaffLeaveAvailability staff={staff} onViewFull={onViewLeaveHistory} /><StaffTrainingHistoryPanel staffId={staff.id} configuration={{ categories: configuration.trainingCategories, statuses: configuration.trainingStatuses, attendanceStatuses: configuration.trainingAttendanceStatuses }} /><footer><button className="secondary" onClick={onEdit}>Edit Staff</button>{staff.assignmentEligible && <button className="secondary danger" onClick={onArchive}>Archive Staff</button>}</footer></aside></div>
}
function formatDate(value: string) { return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`)) }
const countsAsAttendanceException = (record: AttendanceRecord, statuses: ConfigOption[]) => Boolean(statuses.find(status => status.value === record.attendanceStatus)?.metadata?.countsAsException)
function Dashboard({ userDisplayName, staff, dutyOptions, bookingStatuses, onRoster, onBookings, onOccasions, onChargeables, onMaintenance }: { userDisplayName: string; staff: Staff[]; dutyOptions: ConfigOption[]; bookingStatuses: ConfigOption[]; onRoster: () => void; onBookings: () => void; onOccasions: () => void; onChargeables: () => void; onMaintenance: () => void }) {
 const dashboardDate = serviceDate();
 const [roster, setRoster] = useState<RosterEntry[]>([]); const [bookings, setBookings] = useState<BookingRecord[]>([]); const [bookingSummary, setBookingSummary] = useState<BookingSummary>({ totalBookings: 0, expectedCovers: 0, arrived: 0, arrivedCovers: 0, remainingBookings: 0, remainingCovers: 0, noShows: 0, noShowCovers: 0, unassignedTables: 0, unassignedWaiters: 0 });
 const [report, setReport] = useState<OperationalReport | null>(null); const [maintenanceSummary, setMaintenanceSummary] = useState<MaintenanceSummary>({ openIssues: 0, inProgress: 0, completedToday: 0, unresolved: 0, urgentUnresolved: 0, normalUnresolved: 0 });
 useEffect(() => { const run = async () => { const [nextRoster, nextBookings, nextBookingSummary, nextReport, nextMaintenance] = await Promise.all([operationsApi.roster(dashboardDate, dashboardDate), bookingApi.list(dashboardDate), bookingApi.summary(dashboardDate), reportingApi.report('today', dashboardDate, dashboardDate), maintenanceApi.summary(dashboardDate)]); setRoster(nextRoster); setBookings(nextBookings); setBookingSummary(nextBookingSummary); setReport(nextReport); setMaintenanceSummary(nextMaintenance) }; void run().catch(() => undefined) }, [dashboardDate]);
 const duty = (value?: string | null) => dutyOptions.find(option => option.value === value); const team = buildTeamToday(staff, roster, dutyOptions); const { working, off, leave } = team
 const dashboard = buildDashboardData(report, bookingSummary, maintenanceSummary); const serviceBoard = buildHostessServiceBoard(bookings, bookingStatuses, dashboardDate)
 const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
 return <div className="dashboard-page"><section className="hero dashboard-hero"><div><p className="eyebrow">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${dashboardDate}T00:00:00`)).toUpperCase()}</p><h2>Good morning, {userDisplayName}.</h2><p>Here’s the live picture for today’s service.</p></div><button className="primary" onClick={onRoster}>Open Duty Roster →</button></section>
 <section className="dashboard-grid">
 <article className="panel dashboard-card team-card"><div className="panel-title"><div><p className="eyebrow">TEAM TODAY</p><h3>Working</h3></div><button className="link" onClick={onRoster}>View roster →</button></div><strong className="dashboard-number">{working.length}</strong><span className="dashboard-muted">of {team.totalStaff} staff</span><div className="team-groups"><div className="team-duty-group"><b>ON DUTY · {working.length}</b><div className="team-name-grid">{working.map(item => <span key={item.person.id}>{item.person.name}</span>)}{working.length === 0 && <span>None assigned</span>}</div></div><div className="team-secondary-groups"><div><b>OFF · {off.length}</b><p>{off.map(item => item.person.name).join(' · ') || 'None'}</p></div><div><b>ON LEAVE · {leave.length}</b><p>{leave.map(item => `${item.person.name}${duty(item.entry?.dutyCode)?.metadata?.displayCode ? ` — ${duty(item.entry?.dutyCode)?.metadata?.displayCode}` : ''}`).join(' · ') || 'None'}</p></div></div></div></article>
 <article className="panel dashboard-card"><div className="panel-title"><div><p className="eyebrow">BOOKINGS</p><h3>Total covers</h3></div><button className="link" onClick={onBookings}>View bookings →</button></div><strong className="dashboard-number">{dashboard.bookings.totalCovers}</strong><span className="dashboard-muted">service covers</span><div className="dashboard-submetrics"><span><b>Adults</b>{dashboard.bookings.adults}</span><span><b>Kids</b>{dashboard.bookings.kids}</span></div></article>
 <article className="panel dashboard-card"><div className="panel-title"><div><p className="eyebrow">SERVICE PROGRESS</p><h3>Covers arrived</h3></div><button className="link" onClick={onBookings}>View service →</button></div><strong className="dashboard-number">{dashboard.serviceProgress.arrivedCovers}</strong><span className="dashboard-muted">covers arrived</span><div className="dashboard-submetrics"><span><b>Remaining</b>{dashboard.serviceProgress.remainingCovers}</span><span><b>No-shows</b>{dashboard.serviceProgress.noShowCovers}</span></div></article>
 <article className="panel dashboard-card"><div className="panel-title"><div><p className="eyebrow">GUEST OCCASIONS</p><h3>{dashboard.occasions.total} occasions</h3></div></div><div className="dashboard-badges">{dashboard.occasions.categories.map(item => <span key={item.key}>{item.label} <b>{item.count}</b></span>)}{dashboard.occasions.categories.length === 0 && <span>None recorded</span>}</div></article>
 <article className="panel dashboard-card"><div className="panel-title"><div><p className="eyebrow">CHARGEABLE ITEMS</p><h3>{money(dashboard.chargeables.realizedRevenue)} realized revenue</h3></div><button className="link" onClick={onChargeables}>View items →</button></div><div className="dashboard-submetrics"><span><b>Items sold</b>{dashboard.chargeables.itemsSold}</span><span><b>Top item</b>{dashboard.chargeables.topItem}</span></div></article>
 <article className="panel dashboard-card attention-card"><div className="panel-title"><div><p className="eyebrow">ATTENTION NEEDED</p><h3>{dashboard.attention.total ? `${dashboard.attention.total} item${dashboard.attention.total === 1 ? '' : 's'}` : 'ALL CLEAR'}</h3></div></div>{dashboard.attention.total === 0 ? <p className="dashboard-muted">No actionable issues right now.</p> : <div className="attention-list">{dashboard.attention.categories.map(category => <button key={category.key} onClick={category.key === 'maintenance' ? onMaintenance : category.key === 'occasions' ? onOccasions : onBookings}>{category.label} · {category.count}</button>)}</div>}</article>
 <article className="panel dashboard-card tonight-card"><div className="panel-title"><div><p className="eyebrow">TONIGHT AT A GLANCE</p><h3>Live hostess service board</h3></div><div className="hostess-state-summary"><span><b>{serviceBoard.summary.upcomingParties}</b> Upcoming</span><span className="arrived"><b>{serviceBoard.summary.arrivedParties}</b> Arrived</span><span className="noshow"><b>{serviceBoard.summary.noShowParties}</b> No-show</span></div></div><section className="next-arrivals" aria-label={serviceBoard.next.eyebrow}><div><p className="eyebrow">{serviceBoard.next.eyebrow}</p><strong>{serviceBoard.next.label || serviceBoard.zeroMessage}</strong></div>{serviceBoard.next.groups.length > 0 && <div className="next-arrival-groups">{serviceBoard.next.groups.map(group => <span key={group.size}><b>{group.size} Pax</b> × {group.count}</span>)}</div>}</section>{serviceBoard.rows.length > 0 ? <div className="tonight-scroll"><table className="tonight-table"><thead><tr><th>Time</th>{serviceBoard.partySizes.map(size => <th key={size}>{size} pax</th>)}</tr></thead><tbody>{serviceBoard.rows.map(row => <tr key={row.time}><td>{row.label}</td>{serviceBoard.partySizes.map(size => <td key={size}>{row.counts[size] || '—'}</td>)}</tr>)}</tbody></table></div> : <p className="tonight-zero">{serviceBoard.zeroMessage}</p>}</article>
 </section></div> }
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
function Roster({ staff, dutyOptions, onToast }: { staff: Staff[]; dutyOptions: ConfigOption[]; onToast: (message: string) => void }) {
 const [view, setView] = useState<'Weekly' | 'Monthly'>('Weekly'); const [anchor, setAnchor] = useState(serviceDate()); const [mobileDate, setMobileDate] = useState(serviceDate()); const [roster, setRoster] = useState<RosterEntry[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
 const [start, end] = view === 'Weekly' ? weekRange(anchor) : monthRange(anchor); const dates = useMemo(() => calendarDates(start, end), [start, end]); const today = serviceDate()
 const load = async () => { setLoading(true); setError(''); try { setRoster(await operationsApi.roster(start, end)) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Unable to load the duty roster.') } finally { setLoading(false) } }
 useEffect(() => { void load() }, [start, end])
 useEffect(() => { if (mobileDate < start || mobileDate > end) setMobileDate(start) }, [start, end, mobileDate])
 const updateRoster = async (staffId: string, date: string, dutyCode: string) => { try { await operationsApi.updateRoster(staffId, date, dutyCode); await load() } catch (saveError) { onToast(saveError instanceof Error ? saveError.message : 'Unable to save duty assignment.') } }
 const visibleStaff = staff.filter(person => (person.assignmentEligible ?? person.employmentStatus === 'active') || roster.some(entry => entry.staffId === person.id)); const activeStaffIds = useMemo(() => new Set(staff.filter(person => person.assignmentEligible ?? person.employmentStatus === 'active').map(person => person.id)), [staff]); const dutyClassification = (dutyCode: string) => dutyOptions.find(item => item.value === dutyCode)?.metadata?.dutyClassification || 'other'; const countsAsWorking = (dutyCode: string) => Boolean(dutyOptions.find(item => item.value === dutyCode)?.metadata?.countsAsWorking); const coverage = useMemo(() => dates.map(date => { const entries = roster.filter(entry => entry.date === date && activeStaffIds.has(entry.staffId)); return { working: entries.filter(entry => countsAsWorking(entry.dutyCode)).length, off: entries.filter(entry => dutyClassification(entry.dutyCode) === 'off').length, annualLeave: entries.filter(entry => dutyClassification(entry.dutyCode) === 'annualLeave').length } }), [dates, roster, dutyOptions, activeStaffIds]); const periodLabel = `${formatDate(start)} – ${formatDate(end)}`
 const shift = (direction: -1 | 1) => setAnchor(current => view === 'Weekly' ? addCalendarDays(current, direction * 7) : addCalendarMonths(current, direction))
 const shiftMobileDay = (direction: -1 | 1) => { const next = addCalendarDays(mobileDate, direction); setMobileDate(next); if (next < start || next > end) setAnchor(next) }
 return <>
<section className="toolbar">
<div>
<button className={view === 'Weekly' ? 'view active' : 'view'} onClick={() => setView('Weekly')}>Weekly</button>
<button className={view === 'Monthly' ? 'view active' : 'view'} onClick={() => setView('Monthly')}>Monthly</button>
</div>
<div>
<button className="secondary" onClick={() => shift(-1)}>← Previous {view === 'Weekly' ? 'Week' : 'Month'}</button>
<button className="secondary" onClick={() => setAnchor(serviceDate())}>{periodLabel}</button>
<button className="secondary" onClick={() => shift(1)}>Next {view === 'Weekly' ? 'Week' : 'Month'} →</button>
</div>
</section>{loading && <section className="panel inline-state">
<p>Loading duty roster…</p>
</section>}{error && <section className="panel inline-state error-state">
<p>{error}</p>
<button className="secondary" onClick={() => void load()}>Try again</button>
</section>}{!loading && !error && <section className="panel roster-panel">
<div className="panel-title">
<div>
<p className="eyebrow">DUTY COVERAGE</p>
<h3>{view} duty roster</h3>
</div>
</div>
<div className="roster-scroll" tabIndex={0} aria-label="Duty roster table">
<table className="roster">
<thead>
<tr>
<th>Team member</th>{dates.map(date => <th key={date} className={date === today ? 'today' : ''}>{new Intl.DateTimeFormat('en-GB',{weekday:'short'}).format(new Date(`${date}T00:00:00`))}<small>{new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(new Date(`${date}T00:00:00`))}{date === today ? ' · Today' : ''}</small>
</th>)}<th>Working days</th>
</tr>
</thead>
<tbody>{visibleStaff.map(person => { const rows = roster.filter(entry => entry.staffId === person.id); const inactive = !(person.assignmentEligible ?? person.employmentStatus === 'active'); return <tr key={person.id} className={inactive ? 'historical-row' : ''}>
<td>
<b>{person.name}</b>
<small>{person.position} · {person.number}{inactive ? ' · Inactive' : ''}</small>
</td>{dates.map(date => { const entry = rows.find(row => row.date === date); const option = dutyOptions.find(item => item.value === entry?.dutyCode); const available = dutyOptions.filter(item => item.active || item.value === entry?.dutyCode); const dutyTitle = option ? `${dutyDisplayCode(option)} · ${option.label}${option.metadata?.description ? ` — ${option.metadata.description}` : ''}${option.active ? '' : ' (Historical)'}` : 'Unassigned'; return <td key={date} className={date === today ? 'today-column' : undefined}>
<select className={option ? undefined : 'no-assignment'} aria-label={`${person.name} duty ${date}`} title={dutyTitle} disabled={inactive} value={entry?.dutyCode || ''} style={{backgroundColor: option?.color,color:option ? readableDutyText(option.color) : undefined}} onChange={event => void updateRoster(person.id, date, event.target.value)}>
<option value="">Unassigned</option>{available.map(item => <option key={item.id} value={item.value} aria-label={`${dutyDisplayCode(item)}, ${item.label}${item.active ? '' : ', historical'}`} title={item.metadata?.description || item.label}>{dutyDisplayCode(item)}</option>)}</select>
</td>})}<td>{rows.filter(row => countsAsWorking(row.dutyCode)).length}</td>
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
<button className="secondary" aria-label="Previous roster day" onClick={() => shiftMobileDay(-1)}>←</button>
<div>
<span>{new Intl.DateTimeFormat('en-GB',{weekday:'long'}).format(new Date(`${mobileDate}T00:00:00`))}</span>
<strong>{formatDate(mobileDate)}</strong>
</div>
<button className="secondary" aria-label="Next roster day" onClick={() => shiftMobileDay(1)}>→</button>
</div>
<div className="mobile-roster-list">{visibleStaff.map(person => { const entry = roster.find(item => item.staffId === person.id && item.date === mobileDate); const option = dutyOptions.find(item => item.value === entry?.dutyCode); const inactive = !(person.assignmentEligible ?? person.employmentStatus === 'active'); const available = dutyOptions.filter(item => item.active || item.value === entry?.dutyCode); return <article className={inactive ? 'mobile-roster-card historical-row' : 'mobile-roster-card'} key={person.id}>
<div>
<b>{person.name}</b>
<small>{person.number} · {person.position}{inactive ? ' · Inactive' : ''}</small>
</div>
<label>
<span>Assigned duty</span>
<select className={option ? undefined : 'no-assignment'} aria-label={`${person.name} duty ${mobileDate}`} title={option ? `${dutyDisplayCode(option)} · ${option.label}${option.metadata?.description ? ` — ${option.metadata.description}` : ''}${option.active ? '' : ' (Historical)'}` : 'Unassigned'} disabled={inactive} value={entry?.dutyCode || ''} style={{backgroundColor:option?.color,color:option ? readableDutyText(option.color) : undefined}} onChange={event => void updateRoster(person.id, mobileDate, event.target.value)}>
<option value="">Unassigned</option>{available.map(item => <option key={item.id} value={item.value} aria-label={`${dutyDisplayCode(item)}, ${item.label}${item.active ? '' : ', historical'}`} title={item.metadata?.description || item.label}>{dutyDisplayCode(item)}</option>)}</select>
</label>
<span className="duty-description">{option ? dutyDisplayCode(option) : 'Unassigned'}</span>
</article>})}</div>
</div>
</section>}
</>
}
type StaffConfigurationGroup = 'duty-codes' | 'employment-statuses' | 'positions'
function ConfigurationView({ configuration, onSave, onReorderDutyCode, onRemoveDutyCode }: { configuration: typeof config; onSave: (group: StaffConfigurationGroup, option: ConfigOption) => Promise<void>; onReorderDutyCode: (id: string, direction: 'up' | 'down') => Promise<void>; onRemoveDutyCode: (id: string) => Promise<void> }) {
 return <section className="config-grid workforce-config-grid"><DutyCodeManager options={configuration.dutyCodes} onSave={option => onSave('duty-codes', option)} onReorder={onReorderDutyCode} onRemove={onRemoveDutyCode} /><StaffEntitlementsManager /><PublicHolidaySettingsManager /></section>
}
function DutyCodeManager({ options, onSave, onReorder, onRemove }: { options: ConfigOption[]; onSave: (option: ConfigOption) => Promise<void>; onReorder: (id: string, direction: 'up' | 'down') => Promise<void>; onRemove: (id: string) => Promise<void> }) {
 const [editing, setEditing] = useState<ConfigOption | null>(null); const [error, setError] = useState(''); const [movingId, setMovingId] = useState<string | null>(null); const activeOptions = options.filter(option => option.active)
 const move = async (id: string, direction: 'up' | 'down') => { try { setError(''); setMovingId(id); await onReorder(id, direction) } catch (moveError) { setError(moveError instanceof Error ? moveError.message : 'Unable to change Duty Code order.') } finally { setMovingId(null) } }
 const remove = async (option: ConfigOption) => { if (!window.confirm(`Remove ${dutyDisplayCode(option)} · ${option.label}? Historical assignments will remain available.`)) return; try { setError(''); await onRemove(option.id) } catch (removeError) { setError(removeError instanceof Error ? removeError.message : 'Unable to remove the Duty Code.') } }
 return <article className="panel duty-code-manager">
 <div className="panel-title"><div><p className="eyebrow">ROSTER CONFIGURATION</p><h3>Duty Codes</h3></div><button className="primary" onClick={() => setEditing({ id: crypto.randomUUID(), value: '', label: '', color: '#1b6288', active: true, metadata: { displayCode: '', countsAsWorking: true, dutyClassification: 'working' } })}>＋ Add Duty Code</button></div>
 <div className="duty-code-table-wrap" tabIndex={0} aria-label="Duty Code configuration table"><table className="duty-code-table"><thead><tr><th>Code</th><th>Duty Name</th><th>Color</th><th>Preview</th><th>Counts as Working</th><th>Order</th><th>Action</th></tr></thead>
<tbody>{activeOptions.map((option,index) => <tr key={option.id}><td><b>{dutyDisplayCode(option)}</b></td><td>{option.label}<small>{option.metadata?.dutyClassification === 'working' ? 'Working Duty' : option.metadata?.dutyClassification === 'off' ? 'Off' : option.metadata?.dutyClassification === 'annualLeave' ? 'Annual Leave' : option.metadata?.dutyClassification === 'publicHoliday' ? 'Public Holiday' : option.metadata?.dutyClassification === 'sickLeave' ? 'Sick Leave' : 'Other / Special Duty'}</small></td><td><span className="duty-color-dot" style={{backgroundColor:option.color}} aria-label={option.color || 'No color'} /></td><td><span className="duty-code-preview" style={{backgroundColor:option.color,color:readableDutyText(option.color)}}>{dutyDisplayCode(option)}</span></td><td>{option.metadata?.countsAsWorking ? 'Yes' : 'No'}</td><td><span className="order-actions"><button className="icon-action" disabled={movingId !== null || index === 0} aria-label={`Move ${dutyDisplayCode(option)} up`} title="Move Up" onClick={() => void move(option.id,'up')}>↑</button><button className="icon-action" disabled={movingId !== null || index === activeOptions.length - 1} aria-label={`Move ${dutyDisplayCode(option)} down`} title="Move Down" onClick={() => void move(option.id,'down')}>↓</button></span></td><td><button className="link" onClick={() => setEditing(option)}>Edit</button><button className="icon-action remove-action" aria-label={`Remove ${dutyDisplayCode(option)}`} title="Remove Duty Code" onClick={() => void remove(option)}>⌫</button></td></tr>)}</tbody></table></div>
 {error && <p className="save-error" role="alert">{error}</p>}{editing && <DutyCodeForm option={editing} activeOptions={activeOptions} onClose={() => setEditing(null)} onSave={async option => { await onSave(option); setEditing(null) }} />}
 </article>
}
function DutyCodeForm({ option, activeOptions, onClose, onSave }: { option: ConfigOption; activeOptions: ConfigOption[]; onClose: () => void; onSave: (option: ConfigOption) => Promise<void> }) {
 const [form, setForm] = useState<ConfigOption>({ ...option, metadata: { ...option.metadata, displayCode: dutyDisplayCode(option) } }); const [error, setError] = useState(''); const classification = form.metadata?.dutyClassification || 'other'; const fixedWorking = classification === 'working' || classification === 'off' || classification === 'annualLeave' || classification === 'publicHoliday' || classification === 'sickLeave'
 const submit = async (event: FormEvent) => { event.preventDefault(); const displayCode = form.metadata?.displayCode?.trim().toUpperCase() || ''; if (!displayCode || !form.label.trim()) return setError('Display Code and Duty Name are required.'); if (activeOptions.some(item => item.id !== form.id && dutyDisplayCode(item).toUpperCase() === displayCode)) return setError('That Display Code is already in use.'); try { await onSave({ ...form, label: form.label.trim(), metadata: { ...form.metadata, displayCode, dutyClassification: classification, countsAsWorking: classification === 'working' ? true : classification === 'off' || classification === 'annualLeave' || classification === 'publicHoliday' || classification === 'sickLeave' ? false : Boolean(form.metadata?.countsAsWorking) } }) } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Unable to save the Duty Code.') } }
 return <Modal title={option.value ? 'Edit Duty Code' : 'Add Duty Code'} onClose={onClose}><form className="staff-form duty-code-form" onSubmit={event => void submit(event)}>
 <label>Display Code<input required maxLength={12} value={form.metadata?.displayCode || ''} onChange={event => setForm({ ...form, metadata: { ...form.metadata, displayCode: event.target.value.toUpperCase() } })} placeholder="e.g. ON, AL, TRN" /></label>
 <label>Duty Name<input required value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder="Descriptive duty name" /></label>
 <label>Color<div className="duty-color-control"><input type="color" value={form.color || '#1b6288'} onChange={event => setForm({ ...form, color: event.target.value })} /><input aria-label="Color hex value" maxLength={7} value={form.color || '#1b6288'} onChange={event => setForm({ ...form, color: event.target.value })} pattern="#[0-9A-Fa-f]{6}" /></div></label>
 <label>Duty Classification<select value={classification} onChange={event => { const next = event.target.value as NonNullable<ConfigOption['metadata']>['dutyClassification']; setForm({ ...form, metadata: { ...form.metadata, dutyClassification: next, countsAsWorking: next === 'working' ? true : next === 'off' || next === 'annualLeave' || next === 'publicHoliday' || next === 'sickLeave' ? false : Boolean(form.metadata?.countsAsWorking) } }) }}><option value="working">Working Duty</option><option value="off">Off</option><option value="annualLeave">Annual Leave</option><option value="publicHoliday">Public Holiday</option><option value="sickLeave">Sick Leave</option><option value="other">Other / Special Duty</option></select></label>
 <label>Counts as Working<select disabled={fixedWorking} value={form.metadata?.countsAsWorking ? 'yes' : 'no'} onChange={event => setForm({ ...form, metadata: { ...form.metadata, countsAsWorking: event.target.value === 'yes' } })}><option value="yes">Yes</option><option value="no">No</option></select><small>{classification === 'off' || classification === 'annualLeave' || classification === 'publicHoliday' || classification === 'sickLeave' ? 'This classification cannot count as working.' : classification === 'working' ? 'Working Duty always counts as working.' : 'Controls Working Days and Scheduled-to-Work totals.'}</small></label>
 <div className="duty-live-preview"><span>Preview</span><b style={{backgroundColor:form.color,color:readableDutyText(form.color)}}>{form.metadata?.displayCode?.trim() || 'CODE'}</b><small>{form.label || 'Duty Name'}</small></div>
 {error && <p className="save-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary">Save Duty Code</button></div>
 </form></Modal>
}
function ComingSoon({ page }: { page: string }) { return <section className="empty panel">
<div className="empty-icon">◇</div>
<p className="eyebrow">FOUNDATION READY</p>
<h2>{page}</h2>
<p>This module is connected to the shared navigation, design system and configuration architecture. Its workflows are the next implementation increment.</p>
<button className="primary">Plan this module</button>
</section> }
function Modal({ title, children, onClose, wide = false }: { title:string; children:ReactNode; onClose:()=>void; wide?: boolean }) { return <div className="modal-backdrop">
<section className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
<button type="button" className="close" aria-label="Close dialog" title="Close" onClick={onClose}>×</button>
<h2>{title}</h2>{children}</section>
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



