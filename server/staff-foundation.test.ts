import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { BookingRecord, Staff } from '../src/domain.js'
import { BookingRepository } from './booking-repository.js'
import { OperationsRepository } from './operations-repository.js'
import { StaffRepository } from './staff-repository.js'

const dataDirectory = await mkdtemp(join(tmpdir(), 'andalucia-staff-foundation-'))
const activeStaff: Staff = {
  id: randomUUID(), number: 'STAFF-FOUNDATION-001', name: 'Foundation Validation',
  position: 'F&B Attendant', nationality: 'Maldivian',
  division: 'Food & Beverage', department: 'F&B Service', outlet: 'Andalucía',
  identityDocumentNumber: 'VALIDATION-ID', employmentStatus: 'active', joinDate: '2026-09-01'
}

try {
  const staff = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await staff.initialize()
  const operations = new OperationsRepository(staff.getDatabase())
  const bookings = new BookingRepository(staff.getDatabase())
  await operations.initialize()
  await bookings.initialize()

  const saved = await staff.create(activeStaff, 'Foundation test')
  assert.equal(saved.assignmentEligible, true)
  assert.equal(saved.serviceAssignmentEligible, true)
  assert.match(saved.id, /^[0-9a-f-]{36}$/)
  await assert.rejects(staff.create({ ...activeStaff, id: randomUUID(), number: activeStaff.number.toLowerCase() }), /Employee ID already belongs/)

  await operations.updateRoster(saved.id, '2026-09-06', 'ON')
  const booking: BookingRecord = {
    id: randomUUID(), guestName: 'Staff Foundation Guest', roomNumber: 'T-101', birthDate: null,
    arrivalDate: null, departureDate: null, mealPeriod: 'Dinner', reservationDate: '2026-09-06',
    reservationTime: '19:00', bookingNumber: 'STAFF-FOUNDATION-BKG', covers: 2,
    bookingStatus: 'confirmed', bookingSource: 'manual', bookedBy: 'Foundation test', guestNotes: '',
    tableNumber: '', waiterId: saved.id, waiter: null, importSource: 'manual'
  }
  const savedBooking = await bookings.save(booking, 'Foundation test')
  assert.equal(savedBooking.waiterId, saved.id)

  const host = await staff.create({ ...activeStaff, id: randomUUID(), number: 'STAFF-FOUNDATION-HOST', name: 'Host Designation Validation', position: 'Host' }, 'Foundation test')
  assert.equal(host.serviceAssignmentEligible, false)
  await operations.updateRoster(host.id, '2026-09-06', 'ON')
  await assert.rejects(bookings.save({ ...booking, id: randomUUID(), bookingNumber: 'STAFF-FOUNDATION-HOST-BKG', waiterId: host.id }), /not eligible for new booking assignments/)

  const inactive = await staff.update(saved.id, { ...saved, employmentStatus: 'inactive', resignationDate: '2026-09-06' }, 'Foundation test')
  assert.equal(inactive?.assignmentEligible, false)
  assert.equal((await operations.roster('2026-09-06', '2026-09-06'))[0]?.dutyCode, 'ON')
  assert.equal((await bookings.find(booking.id))?.waiter?.name, saved.name)
  await assert.rejects(operations.updateRoster(saved.id, '2026-09-07', 'ON'), /not eligible for new duty assignments/)
  await assert.rejects(bookings.save({ ...booking, id: randomUUID(), bookingNumber: 'STAFF-FOUNDATION-BKG-2' }), /not eligible for new booking assignments/)

  const revised = await staff.update(saved.id, { ...inactive!, position: 'Restaurant Supervisor' }, 'Foundation test')
  assert.equal(revised?.position, 'Restaurant Supervisor')
  const audits = await staff.getDatabase().query<{ action: string }>("select action from audit_logs where entity_type='staff' and entity_id=$1 order by created_at", [saved.id])
  assert.deepEqual(audits.rows.map(row => row.action), ['created', 'status_changed', 'designation_changed'])

  await staff.getDatabase().close()
  const reopened = new StaffRepository(dataDirectory, new PGlite(dataDirectory))
  await reopened.initialize()
  const persisted = await reopened.find(saved.id)
  assert.equal(persisted?.position, 'Restaurant Supervisor')
  assert.equal(persisted?.identityDocumentNumber, 'VALIDATION-ID')
  assert.equal(persisted?.employmentStatus, 'inactive')
  assert.equal((await reopened.configuration()).positions.find(option => option.value === 'Restaurant Supervisor')?.metadata?.serviceAssignmentEligible, true)
  await reopened.getDatabase().close()

  console.log(JSON.stringify({ uuidIdentity: true, employeeIdUniqueness: true, designationBasedServiceEligibility: true, rosterEligibilityIndependentOfDesignation: true, editAndAudit: true, rosterHistoryPreserved: true, waiterHistoryPreserved: true, inactiveNewAssignmentsBlocked: true, restartPersistence: true }, null, 2))
} finally {
  await rm(dataDirectory, { recursive: true, force: true })
}
