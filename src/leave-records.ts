import type { LeaveClassification, StaffLeaveDay, StaffLeaveRecord } from './domain'
import { addCalendarDays, calendarDates } from './service-date'

const canJoin = (days: StaffLeaveDay[], next: StaffLeaveDay) => {
  const last = days[days.length - 1]
  return addCalendarDays(last.date, 1) === next.date && last.classification === next.classification && last.dutyCode === next.dutyCode
}

const makeRecord = (entries: StaffLeaveDay[]): StaffLeaveRecord => {
  const leaveType = entries[0].classification
  const annualLeaveDays = entries.filter(day => day.classification === 'annualLeave').length
  const sickLeaveDays = entries.filter(day => day.classification === 'sickLeave').length
  return {
    id: `${entries[0].staffId}:${entries[0].date}:${entries[entries.length - 1].date}:${leaveType}`,
    staffId: entries[0].staffId,
    staffName: entries[0].staffName,
    staffNumber: entries[0].staffNumber,
    employmentStatus: entries[0].employmentStatus,
    leaveType,
    fromDate: entries[0].date,
    toDate: entries[entries.length - 1].date,
    leaveDays: leaveType === 'sickLeave' ? sickLeaveDays : annualLeaveDays,
    holidays: entries.filter(day => day.classification === 'publicHoliday').length,
    offDays: entries.filter(day => day.classification === 'off').length,
    totalDays: calendarDates(entries[0].date, entries[entries.length - 1].date).length,
    entries
  }
}

export const buildStaffLeaveRecords = (days: StaffLeaveDay[]): StaffLeaveRecord[] => {
  const sorted = [...days].sort((a, b) => a.staffId.localeCompare(b.staffId) || a.date.localeCompare(b.date))
  const groups: StaffLeaveDay[][] = []
  for (const day of sorted) {
    const current = groups[groups.length - 1]
    if (!current || current[0].staffId !== day.staffId || !canJoin(current, day)) groups.push([day])
    else current.push(day)
  }
  return groups.map(makeRecord)
}
