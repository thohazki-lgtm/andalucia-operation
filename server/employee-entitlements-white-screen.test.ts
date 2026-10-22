import assert from 'node:assert/strict'
import { EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS } from '../src/domain'
import { normalizedAdditionalLeave, normalizedLeaveOverrides } from '../src/workforce-entitlement-normalization'

assert.deepEqual(normalizedLeaveOverrides(undefined), {})
assert.equal(normalizedLeaveOverrides({ sickLeave: 0 }).sickLeave, 0)

const absentBalanceLines = normalizedAdditionalLeave(undefined)
assert.equal(absentBalanceLines.length, EMPLOYEE_OVERRIDE_LEAVE_CLASSIFICATIONS.length)
assert.equal(absentBalanceLines.every(line => line.entitlement === null && line.remaining === null), true)

const configuredBalanceLines = normalizedAdditionalLeave([{
  classification: 'sickLeave',
  code: 'SL',
  label: 'Sick Leave',
  entitlement: 0,
  used: 2,
  remaining: -2,
  bookedFuture: null,
  availableAfterBooked: null,
}])
assert.equal(configuredBalanceLines.find(line => line.classification === 'sickLeave')?.entitlement, 0)
assert.equal(configuredBalanceLines.find(line => line.classification === 'emergencyLeave')?.entitlement, null)

console.log(JSON.stringify({
  employeeEntitlementsMissingFieldsSafe: true,
  unconfiguredRemainsNull: true,
  explicitZeroPreserved: true,
  allAdditionalClassificationsRendered: true,
}, null, 2))
