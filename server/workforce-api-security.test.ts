import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('server/index.ts', 'utf8')
const route = (needle: string) => {
  const line = source.split(/\r?\n/).find(value => value.includes(needle))
  assert(line, `Route not found: ${needle}`)
  return line
}

for (const needle of [
  "request.method === 'GET' && url.pathname === '/api/staff'",
  "request.method === 'GET' && url.pathname === '/api/config/staff'"
]) assert(route(needle).includes('authorizedStaffContext(request)'), `${needle} must require authenticated, outlet-scoped Staff permission.`)

for (const needle of [
  "request.method === 'GET' && url.pathname === '/api/roster'",
  "request.method === 'GET' && url.pathname === '/api/attendance'",
  "request.method === 'GET' && url.pathname === '/api/config/attendance-statuses'"
]) assert(route(needle).includes('authorizedWorkforceContext(request)'), `${needle} must require authenticated, outlet-scoped Duty Roster permission.`)

assert(route("request.method === 'GET' && accumulatedOffBalanceMatch").includes('authorizedWorkforceContext(request)'), 'Accumulated OFF balance must require authenticated, outlet-scoped Duty Roster permission.')

for (const needle of [
  "request.method === 'POST' && url.pathname === '/api/staff'",
  "request.method === 'PUT' && match",
  "request.method === 'POST' && url.pathname === '/api/config/attendance-statuses'",
  "request.method === 'PUT' && statusMatch",
  "request.method === 'PUT' && staffConfigMatch",
  "request.method === 'DELETE' && staffConfigMatch",
  "request.method === 'PUT' && attendanceMatch"
  ,"request.method === 'POST' && url.pathname === '/api/workforce/accumulated-off/opening-balance'"
  ,"request.method === 'POST' && accumulatedOffConsumptionMatch"
  ,"request.method === 'POST' && url.pathname === '/api/workforce/accumulated-off/initialize-history'"
]) {
  const value = route(needle)
  assert(value.includes('assertTrustedOrigin(request)'), `${needle} must reject untrusted mutation origins.`)
  assert(value.includes('authorizedStaffContext(request)') || value.includes('authorizedWorkforceContext(request)'), `${needle} must require an explicit workforce permission.`)
}

for (const needle of [
  "request.method === 'POST' && url.pathname === '/api/staff-membership/baseline-reviews'",
  "request.method === 'PUT' && baselineSelectionMatch",
  "request.method === 'DELETE' && baselineSelectionMatch",
  "request.method === 'POST' && baselineActionMatch"
]) assert(route(needle).includes('assertTrustedOrigin(request)'), `${needle} must reject untrusted mutation origins.`)

assert.match(source, /async function authorizedStaffContext[\s\S]*?requireAuthenticatedUser\(request, auth\)[\s\S]*?requireOutletPermission\(principal, 'manage_staff', outlet\.id\)/)
assert.match(source, /async function authorizedWorkforceContext[\s\S]*?requireAuthenticatedUser\(request, auth\)[\s\S]*?requireOutletPermission\(principal, 'manage_duty_roster', outlet\.id\)/)
assert.doesNotMatch(route("request.method === 'PUT' && attendanceMatch"), /staffId:\s*input\.staffId/)

console.log(JSON.stringify({
  anonymousStaffReadsRejectedByRouteGuard: true,
  anonymousRosterAndAttendanceReadsRejectedByRouteGuard: true,
  staffMutationsRequireTrustedOriginAndPermission: true,
  attendanceMutationsRequireTrustedOriginAndPermission: true,
  staffMembershipMutationsRequireTrustedOrigin: true,
  clientAttendanceStaffIdentityIgnored: true,
  managerPermissionsOutletScoped: true
}, null, 2))
