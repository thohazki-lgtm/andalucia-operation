import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('server/index.ts', 'utf8')
const schemaCompatibilityIndex = source.indexOf('await repository.assertCompatibleSchema()')
const authorizationInitializationIndex = source.indexOf('await authorization.initialize()')
assert(schemaCompatibilityIndex >= 0 && authorizationInitializationIndex > schemaCompatibilityIndex, 'Employee-safe permissions must be initialized after Schema 028 compatibility is verified and before requests are served.')
const employeeRoute = source.slice(source.indexOf("url.pathname === '/api/staff-access/snapshot'"), source.indexOf("url.pathname === '/api/staff'"))
assert.match(employeeRoute, /authorizedEmployeeAccessContext\(request\)/)
assert.match(employeeRoute, /principal\.staffId/)
assert.match(employeeRoute, /roster\.filter\(item => item\.staffId === self\.id\)/)
assert.match(employeeRoute, /plannedLeave\.list\([^)]*principal\.staffId!/s)
assert.match(employeeRoute, /currentFinalized\?\.staff\.find\(item => item\.staffId === context\.principal\.staffId\)/)
assert.match(source, /url\.pathname === '\/api\/bookings'\) \{ await authorizedBookingsContext\(request\)/)
assert.match(source, /url\.pathname === '\/api\/bookings\/summary'\) \{ await authorizedBookingsContext\(request\)/)
assert.match(source, /url\.pathname === '\/api\/reports'\) \{ await authorizedReportsContext\(request\)/)
assert.match(source, /url\.pathname === '\/api\/reports\/manager-summary'\) \{ assertTrustedOrigin\(request\); const context = await authorizedReportsContext\(request\)/)
assert.match(source, /const permissions: AuthorizationPermissionKey\[\] = \['view_staff_dashboard',[\s\S]*?'view_staff_reports'\]/)
console.log('Staff access API security guards passed.')
