import type { BookingRecord, GuestOccasionRecord, MaintenanceRecord, OperationalReport, Staff, TrainingSession } from '../src/domain.js'

const emptyPrivateStaffFields = { joinDate: '', nationality: '', identityDocumentNumber: '', createdAt: undefined, updatedAt: undefined, createdBy: undefined, updatedBy: undefined }

export function employeeDirectory(staff: Staff[], staffId: string): Staff[] {
  return staff.map(person => person.id === staffId ? person : { ...person, ...emptyPrivateStaffFields })
}

export function employeeBookings(records: BookingRecord[]): BookingRecord[] {
  return records.map(record => ({ ...record, guestName: 'Guest', roomNumber: '', birthDate: null, arrivalDate: null, departureDate: null, bookingNumber: '', bookedBy: '', guestNotes: '', sourceGuestNotes: null, memberSearchText: undefined, createdBy: undefined, updatedBy: undefined }))
}

export function employeeOccasions(records: GuestOccasionRecord[]): GuestOccasionRecord[] {
  return records.map(record => ({ ...record, guestName: 'Guest', roomNumber: '', bookingNumber: null, sourceText: '', notes: '', sourceFilename: null, knownVisits: null, previousAndaluciaVisits: 0, visitNumber: null, createdBy: undefined, updatedBy: undefined }))
}

export function employeeTraining(records: TrainingSession[], staffId: string): TrainingSession[] {
  return records.filter(record => record.active && (!record.attendees.length || record.attendees.some(attendee => attendee.staffId === staffId))).map(record => ({ ...record, attendees: record.attendees.filter(attendee => attendee.staffId === staffId), sourceData: null, createdBy: undefined, updatedBy: undefined }))
}

export function employeeMaintenance(records: MaintenanceRecord[], staffId: string): MaintenanceRecord[] {
  return records.map(record => ({ ...record, notes: record.reportedByStaffId === staffId ? record.notes : '', reportedBy: record.reportedByStaffId === staffId ? record.reportedBy : null, reporterNameSnapshot: record.reportedByStaffId === staffId ? record.reporterNameSnapshot : null, reporterNumberSnapshot: record.reportedByStaffId === staffId ? record.reporterNumberSnapshot : null, completedByUserId: null, completedByNameSnapshot: null, createdBy: undefined, updatedBy: undefined }))
}

export function employeeReport(report: OperationalReport, staffId: string): OperationalReport {
  return {
    ...report,
    executive: { ...report.executive, chargeableRevenue: 0, attendanceExceptions: 0 },
    attendance: { ...report.attendance, details: report.attendance.details.filter(item => item.staffId === staffId) },
    training: { ...report.training, employeeParticipation: report.training.employeeParticipation.filter(item => item.staffId === staffId) },
    occasions: { ...report.occasions, records: report.occasions.records.map(record => ({ ...record, guestName: 'Guest', roomNumber: '' })) },
    chargeables: { ...report.chargeables, totalRevenue: 0, realizedRevenue: 0, pendingValue: 0, pendingItems: 0, itemsSold: 0, topSeller: '', topSellerRevenue: 0, mostSoldItem: '', topItem: null, topWaiter: null, financialProofRecords: [], byItem: [], byWaiter: [], byDate: [], byWeek: [] },
    earnings: { incentives: { finalizedAmount: 0, provisionalAmount: 0, finalizedRecords: 0, provisionalRecords: 0 }, billTips: { finalizedAmount: 0, provisionalAmount: 0, finalizedMonths: 0, provisionalMonths: 0 }, state: 'not_recorded' },
    managerSummary: null
  }
}
