import assert from 'node:assert/strict'
import { employeeBookings, employeeDirectory, employeeMaintenance, employeeOccasions, employeeTraining } from './staff-access-policy.js'

const self: any = { id: 'staff-1', name: 'Own Name', number: '1', position: 'host', joinDate: '2025-01-01', nationality: 'Private', division: 'F&B', department: 'Restaurant', outlet: 'Andalucia', identityDocumentNumber: 'PRIVATE', employmentStatus: 'active' }
const colleague: any = { ...self, id: 'staff-2', name: 'Colleague', identityDocumentNumber: 'OTHER-PRIVATE' }
assert.equal(employeeDirectory([self, colleague], self.id)[0].identityDocumentNumber, 'PRIVATE')
assert.equal(employeeDirectory([self, colleague], self.id)[1].identityDocumentNumber, '')
assert.equal(employeeBookings([{ guestName: 'Private Guest', roomNumber: '101', guestNotes: 'Private note' } as any])[0].guestName, 'Guest')
assert.equal(employeeOccasions([{ guestName: 'Private Guest', roomNumber: '101', sourceText: 'private' } as any])[0].roomNumber, '')
assert.equal(employeeMaintenance([{ reportedByStaffId: 'staff-2', notes: 'private follow-up', reporterNameSnapshot: 'Colleague' } as any], self.id)[0].notes, '')
assert.equal(employeeTraining([{ active: true, attendees: [{ staffId: 'staff-2' }] } as any], self.id).length, 0)
console.log('Staff access policy tests passed.')
