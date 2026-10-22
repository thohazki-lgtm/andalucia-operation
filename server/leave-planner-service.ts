import { isLeaveClassification, leaveClassificationForCode, type ConfigOption, type LeaveClassification, type LeavePlannerDay, type LeavePlannerReadModel, type LeavePlannerStaffRow, type StaffLeaveDay } from '../src/domain.js'
import { buildStaffLeaveRecords } from '../src/leave-records.js'
import { calendarDates, monthRange, serviceDate, weekRange } from '../src/service-date.js'
import type { OutletMembershipRepository } from './outlet-membership-repository.js'
import { PlannedLeaveRepository } from './planned-leave-repository.js'
import type { StaffRepository } from './staff-repository.js'
import type { AccumulatedOffService } from './accumulated-off-service.js'

const metadataOf = (option?: ConfigOption) => option?.metadata || {}
const displayCodeOf = (option?: ConfigOption, fallback = '') => String(option?.metadata?.displayCode || fallback).toUpperCase()
const leaveClassificationOf = (option?: ConfigOption): LeaveClassification | null => {
  if (!option) return null
  const metadata = metadataOf(option)
  const displayCode = displayCodeOf(option, option.value)
  const classification = metadata.countsAsLeave ? 'annualLeave' : metadata.countsAsOffDay ? 'off' : metadata.countsAsPublicHoliday ? 'publicHoliday' : metadata.countsAsSickLeave ? 'sickLeave' : metadata.dutyClassification
  return isLeaveClassification(classification) ? classification : leaveClassificationForCode(displayCode) || null
}

export class LeavePlannerService {
  private readonly plannedLeave: PlannedLeaveRepository
  constructor(private readonly staff: StaffRepository, private readonly membership: OutletMembershipRepository, plannedLeave?: PlannedLeaveRepository, private readonly accumulatedOff?: AccumulatedOffService) { this.plannedLeave = plannedLeave || new PlannedLeaveRepository(staff.getDatabase(), accumulatedOff) }

  async view(month: string, outletScopeKey = 'andalucia'): Promise<LeavePlannerReadModel> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Select a valid Leave Planner month.')
    const [startDate, endDate] = monthRange(`${month}-01`)
    const resolved = await this.membership.resolveStaffMembershipForRange(startDate, endDate, outletScopeKey)
    if (!resolved.outlet) throw new Error('The Leave Planner outlet is unavailable.')
    const configuration = await this.staff.configuration()
    const dutyByValue = new Map(configuration.dutyCodes.map(option => [option.value, option]))
    const rosterResult = await this.staff.getDatabase().query<any>('select staff_id,duty_date::text date,duty_code_value from duty_roster_entries where duty_date between $1 and $2 order by staff_id,duty_date', [startDate, endDate])
    const rosterByStaff = new Map<string, any[]>()
    for (const row of rosterResult.rows) rosterByStaff.set(row.staff_id, [...(rosterByStaff.get(row.staff_id) || []), row])
    const entitlements = new Map((await this.staff.entitlements()).map(item => [item.staffId, item]))
    const [weekStart, weekEnd] = weekRange(startDate)
    const yearStart = `${month.slice(0, 4)}-01-01`
    const yearEnd = `${month.slice(0, 4)}-12-31`
    const plannedLeaveSupported = await this.plannedLeave.ready()
    const plannedForMonth = plannedLeaveSupported ? await this.plannedLeave.list(resolved.outlet.id, startDate, endDate, undefined, true) : []
    const plannedForYear = plannedLeaveSupported ? await this.plannedLeave.list(resolved.outlet.id, yearStart, yearEnd, undefined, true) : []
    const rows: LeavePlannerStaffRow[] = []

    for (const member of resolved.members) {
      const roster = (rosterByStaff.get(member.staffId) || []).filter(row => row.date >= member.membershipStartWithinPeriod && row.date <= member.membershipEndWithinPeriod)
      const days = roster.flatMap((entry): LeavePlannerDay[] => {
        const option = dutyByValue.get(entry.duty_code_value)
        const classification = leaveClassificationOf(option)
        if (!classification) return []
        return [{ staffId: member.staffId, staffName: member.staffName, staffNumber: member.staffNumber, employmentStatus: member.employmentStatus, date: entry.date, dutyCode: displayCodeOf(option, entry.duty_code_value), dutyLabel: option?.label || entry.duty_code_value, classification, color: option?.color || '#718492', dutyCodeValue: entry.duty_code_value, dutyCodeActive: Boolean(option?.active) }]
      })
      const records = buildStaffLeaveRecords(days as StaffLeaveDay[])
      const entitlement = await this.staff.entitlementBalance(member.staffId, Number(month.slice(0, 4)), weekStart, weekEnd)
      const configured = entitlements.get(member.staffId)
      const memberPlanned = plannedForMonth.filter(period => period.staffId === member.staffId)
      const confirmedDates = new Set(days.map(day => day.date))
      const plannedDates = [...new Set(memberPlanned.filter(period => period.planningState === 'booked').flatMap(period => calendarDates(period.startDate, period.endDate)).filter(date => date >= startDate && date <= endDate && date >= serviceDate() && !confirmedDates.has(date)))]
      const bookedFutureDates = new Set(plannedForYear.filter(period => period.staffId === member.staffId && period.planningState === 'booked').flatMap(period => calendarDates(period.startDate, period.endDate)).filter(date => date >= serviceDate()))
      const confirmedAnnualLeave = new Set(plannedForYear.filter(period => period.staffId === member.staffId).flatMap(period => period.confirmedEvidence.filter(evidence => evidence.classification === 'annualLeave').map(evidence => evidence.date)))
      const legacyBookedFuture = [...bookedFutureDates].filter(date => !confirmedAnnualLeave.has(date)).length
      const bookedFuture = entitlement.annualLeave.serviceYear?.bookedFuture ?? legacyBookedFuture
      const availableAfterBooked = entitlement.annualLeave.serviceYear?.availableAfterBooked ?? (entitlement.annualLeave.remaining === null ? null : entitlement.annualLeave.remaining - bookedFuture)
      const accumulatedOff = this.accumulatedOff ? await this.accumulatedOff.balance(member.staffId, resolved.outlet.id) : { staffId: member.staffId, opening: 0, earned: 0, reserved: 0, consumed: 0, available: 0, conflict: false, evaluatedThrough: null }
      rows.push({
        staffId: member.staffId, staffName: member.staffName, staffNumber: member.staffNumber, designation: member.designation, employmentStatus: member.employmentStatus,
        membershipId: member.membershipId, membershipStart: member.membershipStartWithinPeriod, membershipEnd: member.membershipEndWithinPeriod, membershipReviewStatus: member.reviewStatus,
        days, periods: records.map(record => ({ ...record, designation: member.designation, confirmationSource: 'Duty Roster', entitlementDays: record.leaveType === 'publicHoliday' ? record.holidays : record.leaveType === 'off' ? record.offDays : record.leaveDays, sourceDutyCode: record.entries[0].dutyCode, color: days.find(day => day.date === record.fromDate)?.color || '#718492' })),
        plannedPeriods: memberPlanned, plannedDates,
        entitlement: { ...entitlement, persisted: Boolean(configured?.persisted), offAssignedInMonth: days.filter(day => day.classification === 'off').length, bookedFuture, availableAfterBooked, accumulatedOff }
      })
    }

    rows.sort((a, b) => a.staffName.localeCompare(b.staffName))
    const dateList = calendarDates(startDate, endDate)
    const availability = dateList.map(date => {
      const members = resolved.members.filter(member => member.membershipStartWithinPeriod <= date && member.membershipEndWithinPeriod >= date)
      let scheduledWorking = 0; let unavailable = 0
      for (const member of members) {
        const entry = (rosterByStaff.get(member.staffId) || []).find(item => item.date === date)
        if (!entry) continue
        const option = dutyByValue.get(entry.duty_code_value)
        if (option?.metadata?.countsAsWorking) scheduledWorking++
        else unavailable++
      }
      return { date, members: members.length, scheduledWorking, unavailable, unassigned: members.length - scheduledWorking - unavailable }
    })
    return { outlet: resolved.outlet, month, startDate, endDate, membershipBlocker: resolved.blocker, rows, availability, dutyCodes: configuration.dutyCodes, plannedLeaveSupported }
  }
}
