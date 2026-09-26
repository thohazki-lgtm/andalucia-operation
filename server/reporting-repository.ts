import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { OperationalReport, ReportManagerSummary, ReportPeriodType } from '../src/domain.js'
import { serviceDate } from '../src/service-date.js'

const round2 = (value: number) => Number(value.toFixed(2))
const dateValue = (value: Date) => value.toISOString().slice(0, 10)
const addDays = (value: string, days: number) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return dateValue(date) }
const inclusiveDays = (start: string, end: string) => Math.floor((new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86400000) + 1
const calendarDates = (start: string, end: string) => Array.from({ length: inclusiveDays(start, end) }, (_, index) => addDays(start, index))
const childOnDate = (birthDate: string | null, serviceDate: string) => {
  if (!birthDate) return false
  const birth = new Date(`${birthDate}T00:00:00Z`); const service = new Date(`${serviceDate}T00:00:00Z`)
  let age = service.getUTCFullYear() - birth.getUTCFullYear()
  if (service.getUTCMonth() < birth.getUTCMonth() || (service.getUTCMonth() === birth.getUTCMonth() && service.getUTCDate() < birth.getUTCDate())) age--
  return age >= 0 && age <= 12
}
const mondayFor = (value: string) => { const date = new Date(`${value}T00:00:00Z`); const day = date.getUTCDay(); date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1)); return dateValue(date) }
const metadata = (value: unknown): Record<string, any> => typeof value === 'string' ? JSON.parse(value) : (value || {}) as Record<string, any>

type Snapshot = Omit<OperationalReport, 'period' | 'comparison' | 'managerSummary'>

export class ReportingRepository {
  constructor(private readonly db: PGlite) {}

  private async options(group: string) {
    const result = await this.db.query<any>('select value, label, metadata, active from configuration_options where group_key=$1 order by sort_order, label', [group])
    return result.rows.map(row => ({ ...row, metadata: metadata(row.metadata) }))
  }

  private previousPeriod(type: ReportPeriodType, start: string, end: string): [string, string] | null {
    if (type === 'week') { const previousEnd = addDays(start, -1); return [addDays(previousEnd, -(inclusiveDays(start, end) - 1)), previousEnd] }
    if (type === 'month') { const current = new Date(`${start}T00:00:00Z`); const previousStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)); const previousEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0)); return [dateValue(previousStart), dateValue(previousEnd)] }
    return null
  }

  private async snapshot(start: string, end: string): Promise<Snapshot> {
    const [bookingStatuses, attendanceStatuses, dutyCodes, trainingCategories, trainingStatuses, trainingAttendanceStatuses, occasionTypes, occasionStatuses, chargeableStatuses, maintenanceAreas, maintenanceStatuses] = await Promise.all([
      this.options('booking_statuses'), this.options('attendance_statuses'), this.options('duty_codes'), this.options('training_categories'), this.options('training_statuses'), this.options('training_attendance_statuses'), this.options('occasion_types'), this.options('occasion_statuses'), this.options('chargeable_statuses'), this.options('maintenance_areas'), this.options('maintenance_statuses')
    ])
    const [bookingResult, bookingMemberResult, attendanceResult, trainingResult, occasionResult, chargeableResult, maintenanceResult, maintenanceAuditResult] = await Promise.all([
      this.db.query<any>('select id, reservation_date::text date, reservation_time::text time, booking_status status, covers, birth_date::text birth_date, raw_import_payload from bookings where reservation_date between $1 and $2 order by reservation_date,reservation_time', [start, end]),
      this.db.query<any>('select g.booking_id,g.birth_date::text birth_date from booking_guest_members g join bookings b on b.id=g.booking_id where b.reservation_date between $1 and $2 order by g.booking_id,g.source_row_order', [start, end]),
      this.db.query<any>("select s.id staff_id,s.full_name staff_name,s.staff_number,s.employment_status_key,r.duty_date::text date,r.duty_code_value scheduled_duty,a.actual_duty_code actual_duty,a.actual_status attendance_status from duty_roster_entries r join staff s on s.id=r.staff_id left join attendance_records a on a.staff_id=r.staff_id and a.attendance_date=r.duty_date where r.duty_date between $1 and $2 union all select s.id,s.full_name,s.staff_number,s.employment_status_key,a.attendance_date::text,null,a.actual_duty_code,a.actual_status from attendance_records a join staff s on s.id=a.staff_id where a.attendance_date between $1 and $2 and not exists(select 1 from duty_roster_entries r where r.staff_id=a.staff_id and r.duty_date=a.attendance_date) order by date,staff_name", [start, end]),
      this.db.query<any>('select t.id,t.title,t.training_date::text date,t.category_value category,t.status_value status,t.active,a.staff_id,a.attendance_status_value attendance_status,s.full_name staff_name,s.staff_number,s.employment_status_key from training_sessions t left join training_session_attendees a on a.training_id=t.id left join staff s on s.id=a.staff_id where t.active=true and t.training_date between $1 and $2 order by t.training_date,t.title,s.full_name', [start, end]),
      this.db.query<any>('select g.id,g.booking_id,coalesce(b.reservation_date,g.occasion_date)::text date,coalesce(b.guest_name,g.manual_guest_name) guest_name,coalesce(b.room_number,g.manual_room_number) room_number,coalesce(b.covers,0)::int covers,g.occasion_type,g.status_value status from guest_occasions g left join bookings b on b.id=g.booking_id where g.active=true and coalesce(b.reservation_date,g.occasion_date) between $1 and $2 order by date,guest_name', [start, end]),
      this.db.query<any>("select c.id,c.charge_date::text date,c.guest_name,c.room_number,to_jsonb(c)->>'check_invoice_number' check_invoice_number,c.item_value,c.item_label,c.quantity,c.total_amount,c.waiter_id,c.status,s.full_name waiter_name,s.staff_number waiter_number,s.employment_status_key waiter_employment_status from chargeable_item_records c left join staff s on s.id=c.waiter_id where c.active=true and c.charge_date between $1 and $2 order by c.charge_date,c.created_at", [start, end]),
      this.db.query<any>("select id,issue,issue_date::text date,area_value area,status,priority,coalesce(to_jsonb(maintenance_issues)->>'reference_follow_up','') reference_follow_up,to_jsonb(maintenance_issues)->>'completed_at' completed_at,updated_at::text updated_at from maintenance_issues where issue_date <= $1 order by issue_date,created_at", [end]),
      this.db.query<any>("select entity_id,action,before_data,after_data,created_at::text created_at from audit_logs where entity_type='maintenance_issue' order by created_at,id")
    ])

    const bookingStatus = (value: string) => bookingStatuses.find(option => option.value === value)?.metadata || {}
    const bookingStage = (value: string) => bookingStatus(value).serviceStage || (bookingStatus(value).bookingMetric === 'arrived' ? 'arrived' : bookingStatus(value).bookingMetric === 'noShow' ? 'noShow' : 'remaining')
    const memberBirthDates = new Map<string, Array<string | null>>()
    for (const row of bookingMemberResult.rows) { const values = memberBirthDates.get(row.booking_id) || []; values.push(row.birth_date); memberBirthDates.set(row.booking_id, values) }
    const bookingRows = bookingResult.rows.map(row => { const memberDates = memberBirthDates.get(row.id); const dates = memberDates?.length ? memberDates : [row.birth_date]; const covers = Number(row.covers); const structuredKids = dates.filter(value => childOnDate(value, row.date)).length; let payload: any = row.raw_import_payload; if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch { payload = null } } const resolvedKids = payload?.effective?.coverResolution?.kids ?? payload?.coverResolution?.kids; const kids = Math.min(covers, Number.isInteger(resolvedKids) && resolvedKids >= 0 ? resolvedKids : structuredKids); return { ...row, covers, kids, adults: Math.max(0, covers - kids) } })
    const expectedRows = bookingRows.filter(row => !bookingStatus(row.status).excludesFromExpectedCovers)
    const arrivedRows = bookingRows.filter(row => ['arrived', 'completed'].includes(bookingStage(row.status)))
    const noShowRows = bookingRows.filter(row => bookingStage(row.status) === 'noShow')
    const remainingRows = expectedRows.filter(row => bookingStage(row.status) === 'remaining')
    const serviceRows = bookingRows.filter(row => bookingStage(row.status) !== 'excluded')
    const groupBookings = (field: 'time' | 'date') => (field === 'date' ? calendarDates(start, end) : [...new Set(bookingRows.map(row => row.time?.slice(0, 5) || 'Unscheduled'))].sort()).map(key => { const rows = bookingRows.filter(row => (field === 'time' ? row.time?.slice(0, 5) || 'Unscheduled' : row.date) === key); return { key, rows } })
    const bookingGroupMetrics = (rows: any[]) => { const expected = rows.filter(row => !bookingStatus(row.status).excludesFromExpectedCovers); const service = rows.filter(row => bookingStage(row.status) !== 'excluded'); const remaining = expected.filter(row => bookingStage(row.status) === 'remaining'); const noShows = rows.filter(row => bookingStage(row.status) === 'noShow'); const arrivedCovers = rows.filter(row => ['arrived', 'completed'].includes(bookingStage(row.status))).reduce((sum, row) => sum + row.covers, 0); const expectedCovers = expected.reduce((sum, row) => sum + row.covers, 0); const adults = expected.reduce((sum, row) => sum + row.adults, 0); const kids = expected.reduce((sum, row) => sum + row.kids, 0); const totalCovers = service.reduce((sum, row) => sum + row.covers, 0); const totalAdults = service.reduce((sum, row) => sum + row.adults, 0); const totalKids = service.reduce((sum, row) => sum + row.kids, 0); return { bookings: rows.length, expectedCovers, totalCovers, adults, kids, totalAdults, totalKids, arrivedCovers, arrivalPercent: expectedCovers ? round2(arrivedCovers / expectedCovers * 100) : 0, status: expectedCovers === 0 ? (noShows.length ? 'No-show' : 'No bookings') : arrivedCovers >= expectedCovers ? 'Arrived' : arrivedCovers > 0 ? 'In progress' : 'Expected', remainingBookings: remaining.length, remainingCovers: remaining.reduce((sum, row) => sum + row.covers, 0), noShows: noShows.length, noShowCovers: noShows.reduce((sum, row) => sum + row.covers, 0) } }
    const byTime = groupBookings('time').map(group => ({ time: group.key, ...bookingGroupMetrics(group.rows) }))
    const byDate = groupBookings('date').map(group => ({ date: group.key, ...bookingGroupMetrics(group.rows) }))
    const weekGroups = new Map<string, any[]>(); for (const row of bookingRows) { const key = mondayFor(row.date); const rows = weekGroups.get(key) || []; rows.push(row); weekGroups.set(key, rows) }
    const weekStarts = [...new Set(calendarDates(start, end).map(mondayFor))].sort()
    const byWeek = weekStarts.map(weekStart => { const weekEnd = addDays(weekStart, 6); const clippedStart = weekStart < start ? start : weekStart; const clippedEnd = weekEnd > end ? end : weekEnd; return { weekStart: clippedStart, weekEnd: clippedEnd, label: `${clippedStart} – ${clippedEnd}`, ...bookingGroupMetrics(weekGroups.get(weekStart) || []) } })
    const expectedCovers = expectedRows.reduce((sum, row) => sum + Number(row.covers), 0)
    const totalCovers = serviceRows.reduce((sum, row) => sum + Number(row.covers), 0)
    const arrivedCovers = arrivedRows.reduce((sum, row) => sum + Number(row.covers), 0)
    const busiest = [...byDate].sort((a, b) => b.expectedCovers - a.expectedCovers || b.bookings - a.bookings)[0]
    const adults = expectedRows.reduce((sum, row) => sum + row.adults, 0); const kids = expectedRows.reduce((sum, row) => sum + row.kids, 0)
    const totalAdults = serviceRows.reduce((sum, row) => sum + row.adults, 0); const totalKids = serviceRows.reduce((sum, row) => sum + row.kids, 0)
    const bookings = { totalBookings: bookingRows.length, expectedCovers, totalCovers, adults, kids, totalAdults, totalKids, arrivedBookings: arrivedRows.length, arrivedCovers, arrivalPercent: expectedCovers ? round2(arrivedCovers / expectedCovers * 100) : 0, remainingBookings: remainingRows.length, remainingCovers: remainingRows.reduce((sum, row) => sum + Number(row.covers), 0), noShows: noShowRows.length, noShowCovers: noShowRows.reduce((sum, row) => sum + Number(row.covers), 0), noShowRate: serviceRows.length ? round2(noShowRows.length / serviceRows.length * 100) : 0, averageCoversPerBooking: expectedRows.length ? round2(expectedCovers / expectedRows.length) : 0, busiestDate: busiest?.date || null, averageCoversPerDay: round2(expectedCovers / Math.max(1, inclusiveDays(start, end))), byTime, byDate, byWeek }

    const attendanceDetails = attendanceResult.rows.map((row: any) => { const option = attendanceStatuses.find(item => item.value === row.attendance_status); return { date: row.date, staffId: row.staff_id, staffName: row.staff_name, staffNumber: row.staff_number, employmentStatus: row.employment_status_key, scheduledDuty: row.scheduled_duty, actualDuty: row.actual_duty, attendanceStatus: row.attendance_status, isException: Boolean(option?.metadata?.countsAsException) } }).sort((a: any, b: any) => Number(b.isException) - Number(a.isException) || a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName))
    const dutyClassification = (value: string | null) => dutyCodes.find(option => option.value === value)?.metadata?.dutyClassification
    const isWorkingDuty = (value: string | null) => Boolean(dutyCodes.find(option => option.value === value)?.metadata?.countsAsWorking)
    const attendance = { scheduledStaff: attendanceDetails.filter(row => row.scheduledDuty && isWorkingDuty(row.scheduledDuty)).length, actualWorking: attendanceDetails.filter(row => row.actualDuty && isWorkingDuty(row.actualDuty)).length, off: attendanceDetails.filter(row => dutyClassification(row.scheduledDuty) === 'off').length, annualLeave: attendanceDetails.filter(row => dutyClassification(row.scheduledDuty) === 'annualLeave').length, exceptions: attendanceDetails.filter(row => row.isException).length, details: attendanceDetails }

    const categoryLabel = (value: string) => trainingCategories.find(option => option.value === value)?.label || value
    const trainingStatusLabel = (value: string) => trainingStatuses.find(option => option.value === value)?.label || value
    const trainingAttendanceStage = (value: string | null) => trainingAttendanceStatuses.find(item => item.value === value)?.metadata?.trainingAttendanceOutcome || 'other'
    const sessions = new Map<string, any>()
    const employees = new Map<string, any>()
    for (const row of trainingResult.rows) {
      if (!sessions.has(row.id)) sessions.set(row.id, { id: row.id, date: row.date, title: row.title, category: categoryLabel(row.category), status: trainingStatusLabel(row.status), participants: 0, attended: 0, absent: 0, excused: 0 })
      if (!row.staff_id) continue
      const session = sessions.get(row.id); session.participants++
      const stage = trainingAttendanceStage(row.attendance_status); if (stage !== 'other') session[stage]++
      if (!employees.has(row.staff_id)) employees.set(row.staff_id, { staffId: row.staff_id, staffName: row.staff_name, staffNumber: row.staff_number, employmentStatus: row.employment_status_key, sessions: 0, attended: 0 })
      const employee = employees.get(row.staff_id); employee.sessions++; if (stage === 'attended') employee.attended++
    }
    const sessionDetails = [...sessions.values()]
    const training = { sessions: sessionDetails.length, participants: sessionDetails.reduce((sum, item) => sum + item.participants, 0), attended: sessionDetails.reduce((sum, item) => sum + item.attended, 0), absent: sessionDetails.reduce((sum, item) => sum + item.absent, 0), excused: sessionDetails.reduce((sum, item) => sum + item.excused, 0), sessionDetails, employeeParticipation: [...employees.values()].sort((a, b) => b.sessions - a.sessions || a.staffName.localeCompare(b.staffName)) }

    const approvedOccasionCategories = [{ key: 'honeymoon', label: 'Honeymoon' }, { key: 'birthday', label: 'Birthday' }, { key: 'anniversary', label: 'Anniversary' }, { key: 'seeYouSoon', label: 'See You Soon' }, { key: 'siyamFamily', label: 'Siyam Family' }, { key: 'famtrip', label: 'Famtrip' }, { key: 'presstrip', label: 'Presstrip' }]
    const occasionType = (value: string) => occasionTypes.find(option => option.value === value)
    const occasionTypeLabel = (value: string) => occasionType(value)?.label || value
    const occasionCategory = (value: string) => occasionType(value)?.metadata?.occasionCategory || value
    const occasionStatusLabel = (value: string) => occasionStatuses.find(option => option.value === value)?.label || value
    const occasionCompleted = (value: string) => occasionStatuses.find(option => option.value === value)?.metadata?.occasionStage === 'completed'
    const occasionRows = occasionResult.rows
    const categoryBreakdown = (rows: any[]) => approvedOccasionCategories.map(category => ({ ...category, count: rows.filter(row => occasionCategory(row.occasion_type) === category.key).length }))
    const byCategory = categoryBreakdown(occasionRows)
    const occasionByDate = calendarDates(start, end).map(date => { const rows = occasionRows.filter(row => row.date === date); return { date, total: rows.length, byCategory: categoryBreakdown(rows) } })
    const occasionWeekStarts = [...new Set(calendarDates(start, end).map(mondayFor))].sort()
    const occasionByWeek = occasionWeekStarts.map(weekStart => { const weekEnd = addDays(weekStart, 6); const clippedStart = weekStart < start ? start : weekStart; const clippedEnd = weekEnd > end ? end : weekEnd; const rows = occasionRows.filter(row => mondayFor(row.date) === weekStart); return { weekStart: clippedStart, weekEnd: clippedEnd, label: `${clippedStart} – ${clippedEnd}`, total: rows.length, byCategory: categoryBreakdown(rows) } })
    const statusWorkflows = [{ key: 'attention', label: 'Attention' }, { key: 'prepared', label: 'Prepared' }, { key: 'completed', label: 'Completed' }]
    const byStatus = statusWorkflows.map(workflow => ({ ...workflow, count: occasionRows.filter(row => occasionStatuses.find(option => option.value === row.status)?.metadata?.occasionWorkflow === workflow.key).length }))
    const occasions = { total: occasionRows.length, completed: occasionRows.filter(row => occasionCompleted(row.status)).length, pendingActive: occasionRows.filter(row => !occasionCompleted(row.status)).length, requiringAttention: occasionRows.filter(row => occasionStatuses.find(option => option.value === row.status)?.metadata?.countsAsOccasionAttention).length, byType: byCategory, byCategory, byStatus, byDate: occasionByDate, byWeek: occasionByWeek, records: occasionRows.map(row => ({ id: row.id, bookingId: row.booking_id || null, date: row.date, guestName: row.guest_name, roomNumber: row.room_number || '', covers: Number(row.covers || 0), occasionType: occasionTypeLabel(row.occasion_type), category: occasionCategory(row.occasion_type), status: occasionStatusLabel(row.status) })) }

    const chargeMetadata = (value: string) => chargeableStatuses.find(option => option.value === value)?.metadata || {}
    const chargeRows = chargeableResult.rows.filter(row => chargeMetadata(row.status).countsAsRealizedRevenue)
    const pendingRows = chargeableResult.rows.filter(row => chargeMetadata(row.status).countsAsPendingValue)
    const totalRevenue = round2(chargeRows.reduce((sum, row) => sum + Number(row.total_amount), 0))
    const pendingValue = round2(pendingRows.reduce((sum, row) => sum + Number(row.total_amount), 0))
    const itemGroups = new Map<string, any>(); const waiterGroups = new Map<string, any>()
    const cleanItem = (row: any) => row.item_value?.startsWith('birthday_') ? { key: 'birthday', label: 'Birthday' } : row.item_value?.startsWith('anniversary_') ? { key: 'anniversary', label: 'Anniversary' } : row.item_value === 'lobster_paella' ? { key: 'lobster_paella', label: 'Lobster Paella' } : { key: String(row.item_value || row.item_label).replace(/_(basic|premium)$/i, ''), label: String(row.item_label || row.item_value).replace(/\s+(Basic|Premium)$/i, '') }
    for (const row of chargeRows) {
      const clean = cleanItem(row); const itemKey = clean.key; if (!itemGroups.has(itemKey)) itemGroups.set(itemKey, { itemValue: itemKey, item: clean.label, quantity: 0, revenue: 0 }); const item = itemGroups.get(itemKey); item.quantity += Number(row.quantity); item.revenue = round2(item.revenue + Number(row.total_amount))
      const waiterKey = row.waiter_id || 'unassigned'; if (!waiterGroups.has(waiterKey)) waiterGroups.set(waiterKey, { waiterId: row.waiter_id, waiter: row.waiter_name || 'Unassigned', staffNumber: row.waiter_number || '', employmentStatus: row.waiter_id ? row.waiter_employment_status : 'unassigned', itemsSold: 0, revenue: 0, items: new Map<string, any>() }); const waiter = waiterGroups.get(waiterKey); waiter.itemsSold += Number(row.quantity); waiter.revenue = round2(waiter.revenue + Number(row.total_amount)); if (!waiter.items.has(itemKey)) waiter.items.set(itemKey, { item: clean.label, quantity: 0, revenue: 0 }); const waiterItem = waiter.items.get(itemKey); waiterItem.quantity += Number(row.quantity); waiterItem.revenue = round2(waiterItem.revenue + Number(row.total_amount))
    }
    const byItem = [...itemGroups.values()].sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
    const byWaiter = [...waiterGroups.values()].sort((a, b) => b.revenue - a.revenue || a.waiter.localeCompare(b.waiter)).map((waiter, index) => ({ ...waiter, rank: index + 1, revenuePercent: totalRevenue ? round2(waiter.revenue / totalRevenue * 100) : 0, items: [...waiter.items.values()].sort((a: any, b: any) => b.revenue - a.revenue) }))
    const topSeller = byWaiter.find(item => item.waiterId) || null
    const topItem = [...byItem].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)[0] || null
    const chargeMetrics = (rows: any[]) => ({ realizedRevenue: round2(rows.reduce((sum, row) => sum + Number(row.total_amount), 0)), itemsSold: rows.reduce((sum, row) => sum + Number(row.quantity), 0) })
    const chargeByDate = calendarDates(start, end).map(date => ({ date, ...chargeMetrics(chargeRows.filter(row => row.date === date)) }))
    const chargeWeekStarts = [...new Set(calendarDates(start, end).map(mondayFor))].sort()
    const chargeByWeek = chargeWeekStarts.map(weekStart => { const weekEnd = addDays(weekStart, 6); const clippedStart = weekStart < start ? start : weekStart; const clippedEnd = weekEnd > end ? end : weekEnd; return { weekStart: clippedStart, weekEnd: clippedEnd, label: `${clippedStart} – ${clippedEnd}`, ...chargeMetrics(chargeRows.filter(row => mondayFor(row.date) === weekStart)) } })
    const financialProofRecords = chargeRows.map(row => ({ id: row.id, date: row.date, guestName: row.guest_name, roomNumber: row.room_number || '', checkInvoiceNumber: row.check_invoice_number || '', item: row.item_label || row.item_value, quantity: Number(row.quantity), grossTotal: Number(row.total_amount), status: chargeableStatuses.find(option => option.value === row.status)?.label || row.status, waiter: row.waiter_name || 'Unassigned' }))
    const chargeables = { totalRevenue, realizedRevenue: totalRevenue, pendingValue, pendingItems: pendingRows.reduce((sum, row) => sum + Number(row.quantity), 0), itemsSold: chargeRows.reduce((sum, row) => sum + Number(row.quantity), 0), topSeller: topSeller?.waiter || '—', topSellerRevenue: topSeller?.revenue || 0, mostSoldItem: topItem?.item || '—', topItem: topItem ? { item: topItem.item, quantity: topItem.quantity, revenue: topItem.revenue } : null, topWaiter: topSeller ? { waiterId: topSeller.waiterId, waiter: topSeller.waiter, staffNumber: topSeller.staffNumber, employmentStatus: topSeller.employmentStatus, itemsSold: topSeller.itemsSold, revenue: topSeller.revenue, revenuePercent: topSeller.revenuePercent } : null, financialProofRecords, byItem, byWaiter, byDate: chargeByDate, byWeek: chargeByWeek }

    const maintenanceStage = (value: string | undefined) => maintenanceStatuses.find(option => option.value === value)?.metadata?.maintenanceStage || 'open'
    const areaLabel = (value: string) => maintenanceAreas.find(option => option.value === value)?.label || value
    const maintenanceAllRows = maintenanceResult.rows
    const maintenanceRows = maintenanceAllRows.filter(row => row.date >= start && row.date <= end)
    const completionDates = new Map<string, string>()
    for (const audit of maintenanceAuditResult.rows) {
      const before = metadata(audit.before_data); const after = metadata(audit.after_data)
      if (maintenanceStage(after.status) === 'completed' && maintenanceStage(before.status) !== 'completed') completionDates.set(audit.entity_id, serviceDate(new Date(audit.created_at)))
    }
    for (const row of maintenanceAllRows) if (row.completed_at) completionDates.set(row.id, serviceDate(new Date(row.completed_at)))
    const completedRows = maintenanceAllRows.filter(row => { const completed = completionDates.get(row.id); return completed && completed >= start && completed <= end })
    const areaGroups = new Map<string, number>(); for (const row of maintenanceRows) areaGroups.set(row.area, (areaGroups.get(row.area) || 0) + 1)
    const maintenanceByDate = calendarDates(start, end).map(date => ({ date, issuesReported: maintenanceRows.filter(row => row.date === date).length, completed: completedRows.filter(row => completionDates.get(row.id) === date).length }))
    const maintenanceWeekStarts = [...new Set(calendarDates(start, end).map(mondayFor))].sort()
    const maintenanceByWeek = maintenanceWeekStarts.map(weekStart => { const weekEnd = addDays(weekStart, 6); const clippedStart = weekStart < start ? start : weekStart; const clippedEnd = weekEnd > end ? end : weekEnd; return { weekStart: clippedStart, weekEnd: clippedEnd, label: `${clippedStart} – ${clippedEnd}`, issuesReported: maintenanceRows.filter(row => mondayFor(row.date) === weekStart).length, completed: completedRows.filter(row => mondayFor(completionDates.get(row.id)!) === weekStart).length } })
    const open = maintenanceRows.filter(row => maintenanceStage(row.status) === 'open').length
    const inProgress = maintenanceRows.filter(row => maintenanceStage(row.status) === 'inProgress').length
    const completedDuringPeriod = completedRows.length
    const unresolvedRows = maintenanceRows.filter(row => maintenanceStage(row.status) !== 'completed')
    const maintenance = { issuesReported: maintenanceRows.length, open, inProgress, completed: completedDuringPeriod, completedDuringPeriod, completedToday: start === end ? completedDuringPeriod : 0, unresolved: unresolvedRows.length, urgentUnresolved: unresolvedRows.filter(row => row.priority === 'urgent').length, normalUnresolved: unresolvedRows.filter(row => row.priority !== 'urgent').length, byArea: [...areaGroups].map(([key, count]) => ({ key, label: areaLabel(key), count })).sort((a, b) => b.count - a.count), byDate: maintenanceByDate, byWeek: maintenanceByWeek, records: maintenanceRows.map(row => ({ id: row.id, date: row.date, completionDate: completionDates.get(row.id) || null, issue: row.issue, area: areaLabel(row.area), status: maintenanceStatuses.find(option => option.value === row.status)?.label || row.status, priority: row.priority === 'urgent' ? 'Urgent' : 'Normal', referenceFollowUp: row.reference_follow_up || '' })) }
    const executive = { totalBookings: bookings.totalBookings, expectedCovers: bookings.expectedCovers, arrivedCovers: bookings.arrivedCovers, noShows: bookings.noShows, guestOccasions: occasions.total, chargeableRevenue: chargeables.totalRevenue, attendanceExceptions: attendance.exceptions, openMaintenanceIssues: maintenance.open + maintenance.inProgress }
    return { executive, bookings, attendance, training, occasions, chargeables, maintenance }
  }

  async report(type: ReportPeriodType, startDate: string, endDate: string): Promise<OperationalReport> {
    if (!['today', 'week', 'month', 'custom'].includes(type)) throw new Error('Select a valid report period.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new Error('Select a valid report date range.')
    const dayCount = inclusiveDays(startDate, endDate)
    if (dayCount > 366) throw new Error('Reports are limited to 366 days per request.')
    const current = await this.snapshot(startDate, endDate)
    const previousPeriod = this.previousPeriod(type, startDate, endDate)
    const previous = previousPeriod ? await this.snapshot(previousPeriod[0], previousPeriod[1]) : null
    const compare = (key: string, label: string, currentValue: number, previousValue: number, favorableWhen: 'up' | 'down' | 'neutral') => ({ key, label, current: currentValue, previous: previousValue, changePercent: previousValue ? round2((currentValue - previousValue) / Math.abs(previousValue) * 100) : currentValue ? null : 0, movement: currentValue > previousValue ? 'up' as const : currentValue < previousValue ? 'down' as const : 'flat' as const, favorableWhen })
    const comparison = previous ? [compare('covers', 'Total Covers', current.bookings.totalCovers, previous.bookings.totalCovers, 'up'), compare('adults', 'Adults', current.bookings.totalAdults, previous.bookings.totalAdults, 'up'), compare('kids', 'Kids', current.bookings.totalKids, previous.bookings.totalKids, 'neutral'), compare('no_show_covers', 'No-Show Covers', current.bookings.noShowCovers, previous.bookings.noShowCovers, 'down')] : []
    const managerSummary = await this.getManagerSummary(type, startDate, endDate)
    return { period: { type, startDate, endDate, previousStartDate: previousPeriod?.[0] || null, previousEndDate: previousPeriod?.[1] || null, dayCount }, ...current, comparison, managerSummary }
  }

  async getManagerSummary(periodType: ReportPeriodType, startDate: string, endDate: string): Promise<ReportManagerSummary | null> {
    const result = await this.db.query<any>('select id,period_type,start_date::text,end_date::text,manager_notes,created_at::text,updated_at::text,created_by,updated_by from report_manager_summaries where period_type=$1 and start_date=$2 and end_date=$3', [periodType, startDate, endDate])
    const row = result.rows[0]
    return row ? { id: row.id, periodType: row.period_type, startDate: row.start_date, endDate: row.end_date, managerNotes: row.manager_notes, createdAt: row.created_at, updatedAt: row.updated_at, createdBy: row.created_by, updatedBy: row.updated_by } : null
  }

  async saveManagerSummary(summary: ReportManagerSummary, actor = 'Venue Manager'): Promise<ReportManagerSummary> {
    const previous = await this.getManagerSummary(summary.periodType, summary.startDate, summary.endDate)
    const id = previous?.id || summary.id || randomUUID()
    await this.db.query('insert into report_manager_summaries (id,period_type,start_date,end_date,manager_notes,created_by,updated_by) values ($1,$2,$3,$4,$5,$6,$6) on conflict (period_type,start_date,end_date) do update set manager_notes=excluded.manager_notes,updated_by=excluded.updated_by,updated_at=now()', [id, summary.periodType, summary.startDate, summary.endDate, summary.managerNotes || '', actor])
    const saved = await this.getManagerSummary(summary.periodType, summary.startDate, summary.endDate)
    if (!saved) throw new Error('Manager summary could not be saved.')
    await this.db.query('insert into audit_logs (id,entity_type,entity_id,action,before_data,after_data,actor) values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'report_manager_summary', saved.id, previous ? 'updated' : 'created', previous ? JSON.stringify(previous) : null, JSON.stringify(saved), actor])
    return saved
  }
}
