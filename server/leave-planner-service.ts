import type { ConfigOption, LeaveClassification, LeavePlannerDay, LeavePlannerReadModel, LeavePlannerStaffRow, StaffLeaveDay } from '../src/domain.js'
import { buildStaffLeaveRecords } from '../src/leave-records.js'
import { calendarDates, monthRange, weekRange } from '../src/service-date.js'
import type { OutletMembershipRepository } from './outlet-membership-repository.js'
import type { StaffRepository } from './staff-repository.js'

const leaveClassifications: LeaveClassification[] = ['annualLeave', 'off', 'publicHoliday', 'sickLeave']

const metadataOf = (option?: ConfigOption) => option?.metadata || {}
const displayCodeOf = (option?: ConfigOption, fallback = '') => String(option?.metadata?.displayCode || fallback).toUpperCase()
const leaveClassificationOf = (option?: ConfigOption): LeaveClassification | null => {
  if (!option) return null
  const metadata = metadataOf(option)
  const displayCode = displayCodeOf(option, option.value)
  const fallback: Partial<Record<string, LeaveClassification>> = { AL: 'annualLeave', OFF: 'off', PH: 'publicHoliday', SK: 'sickLeave' }
  const classification = metadata.countsAsLeave ? 'annualLeave' : metadata.countsAsOffDay ? 'off' : metadata.countsAsPublicHoliday ? 'publicHoliday' : metadata.countsAsSickLeave ? 'sickLeave' : metadata.dutyClassification
  return leaveClassifications.includes(classification as LeaveClassification) ? classification as LeaveClassification : fallback[displayCode] || null
}

export class LeavePlannerService {
  constructor(private readonly staff: StaffRepository, private readonly membership: OutletMembershipRepository) {}

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
      rows.push({
        staffId: member.staffId, staffName: member.staffName, staffNumber: member.staffNumber, designation: member.designation, employmentStatus: member.employmentStatus,
        membershipId: member.membershipId, membershipStart: member.membershipStartWithinPeriod, membershipEnd: member.membershipEndWithinPeriod, membershipReviewStatus: member.reviewStatus,
        days, periods: records.map(record => ({ ...record, designation: member.designation, confirmationSource: 'Duty Roster', entitlementDays: record.leaveType === 'annualLeave' || record.leaveType === 'sickLeave' ? record.leaveDays : record.leaveType === 'publicHoliday' ? record.holidays : record.offDays, sourceDutyCode: record.entries[0].dutyCode, color: days.find(day => day.date === record.fromDate)?.color || '#718492' })),
        entitlement: { ...entitlement, persisted: Boolean(configured?.persisted), offAssignedInMonth: days.filter(day => day.classification === 'off').length }
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
    return { outlet: resolved.outlet, month, startDate, endDate, membershipBlocker: resolved.blocker, rows, availability, dutyCodes: configuration.dutyCodes }
  }
}
