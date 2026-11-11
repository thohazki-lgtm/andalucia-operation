import type { TimesheetDayInput } from './domain'

export const officialTimesheetExportAvailable = (status: string) => status === 'approved' || status === 'locked'

export const timesheetReopenAvailable = (editingLocked: boolean) => editingLocked

export const activeTimesheetEditingWindow = (editingLocked: boolean, reopenedUntil: string | null, now = Date.now()) =>
  !editingLocked && Boolean(reopenedUntil) && new Date(reopenedUntil as string).getTime() > now

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/

const shiftMinutes = (timeIn: string | null, timeOut: string | null) => {
  if (!timeIn || !timeOut || !timePattern.test(timeIn) || !timePattern.test(timeOut)) return 0
  const [inHour, inMinute] = timeIn.split(':').map(Number)
  const [outHour, outMinute] = timeOut.split(':').map(Number)
  const start = inHour * 60 + inMinute
  const end = outHour * 60 + outMinute
  return end >= start ? end - start : (24 * 60 - start) + end
}

export const calculatedShiftMinutes = (input: TimesheetDayInput) =>
  shiftMinutes(input.firstShift.timeIn, input.firstShift.timeOut) + shiftMinutes(input.secondShift.timeIn, input.secondShift.timeOut)
