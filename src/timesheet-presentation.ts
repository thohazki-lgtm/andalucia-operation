import type { TimesheetDayView } from './domain'

export const timesheetHasRecordedWork = (day: TimesheetDayView) =>
  Boolean(day.totalMinutes > 0 || day.firstShift.timeIn || day.firstShift.timeOut || day.secondShift.timeIn || day.secondShift.timeOut)

export const timesheetIsReadOnlyNonWorkingDay = (day: TimesheetDayView) =>
  Boolean(day.scheduledDuty && !day.scheduledDuty.countsAsWorking && !timesheetHasRecordedWork(day))

export const timesheetShiftPresentation = (day: TimesheetDayView, shift: 'firstShift' | 'secondShift') => {
  const value = day[shift]
  if (value.timeIn || value.timeOut) return { text: `${value.timeIn || '—'}–${value.timeOut || '—'}`, rostered: false }
  if (!timesheetHasRecordedWork(day) && day.scheduledDuty && !day.scheduledDuty.countsAsWorking) return { text: day.scheduledDuty.code, rostered: true }
  return { text: '—', rostered: false }
}

export const timesheetConfirmationPresentation = (day: TimesheetDayView) => {
  const incomplete = Boolean(day.firstShift.timeIn) !== Boolean(day.firstShift.timeOut) || Boolean(day.secondShift.timeIn) !== Boolean(day.secondShift.timeOut)
  if (day.state === 'confirmed') return { label: 'Confirmed', state: 'confirmed' }
  if (incomplete) return { label: 'Incomplete', state: 'incomplete' }
  if (day.state === 'draft') return { label: 'Draft', state: 'draft' }
  if (day.scheduledDuty?.countsAsWorking && !timesheetHasRecordedWork(day)) return { label: 'Missing', state: 'missing' }
  return { label: 'Not started', state: 'not-started' }
}
