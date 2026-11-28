import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { accessibleApplicationPages, canAccessCustomizationCategory } from '../src/module-access.js'
import type { AuthorizationPermissionKey } from '../src/domain.js'

const pagesFor = (...permissionKeys: AuthorizationPermissionKey[]) => accessibleApplicationPages({ permissionKeys })

assert.deepEqual(
  pagesFor('view_own_roster', 'view_own_timesheet', 'edit_own_timesheet', 'confirm_own_timesheet_days', 'submit_own_timesheet_month'),
  ['Duty Roster', 'My Timesheet'],
  'A pure employee account may view only its own roster and self-service timesheet.'
)

const employeeModulePermissions: AuthorizationPermissionKey[] = ['view_staff_dashboard', 'view_staff_directory', 'view_own_roster', 'view_own_leave', 'view_staff_training', 'view_service_bookings', 'view_guest_occasions', 'view_own_earnings', 'view_maintenance', 'view_staff_reports', 'view_own_timesheet']
assert.deepEqual(pagesFor(...employeeModulePermissions), ['Dashboard', 'Staff Management', 'Duty Roster', 'Leave Planner', 'Training', 'Bookings', 'Guest Occasions', 'Incentives & Bill Tips', 'Maintenance', 'Reports', 'My Timesheet'])
assert(!pagesFor(...employeeModulePermissions).includes('Customization Center'), 'Employee-safe permissions must never expose Customization Center.')

assert.deepEqual(
  pagesFor('manage_training', 'manage_bookings', 'manage_guest_occasions', 'manage_chargeables', 'manage_maintenance'),
  ['Customization Center'],
  'Operational permissions alone must not expose staff-dependent main modules without the protected staff directory.'
)

assert.deepEqual(
  pagesFor('manage_staff', 'manage_training'),
  ['Staff Management', 'Training', 'Customization Center'],
  'A staff-directory-authorized training manager should reuse the existing Training module.'
)

assert(!pagesFor('view_reports').includes('Reports'), 'The legacy report-view permission must not expose manager report APIs.')
assert(pagesFor('manage_reports').includes('Reports'), 'The report UI should be exposed with its verified backend permission.')
assert(!pagesFor('manage_staff', 'manage_chargeables', 'manage_incentives').includes('Incentives & Bill Tips'), 'Private financial UI requires Bill Tip authority as well as chargeable and incentive authority.')
assert(pagesFor('manage_staff', 'manage_chargeables', 'manage_incentives', 'manage_bill_tips').includes('Incentives & Bill Tips'))

assert(!canAccessCustomizationCategory({ permissionKeys: ['manage_training'] }, 'training'), 'Training customization needs the protected staff directory for trainer selection.')
assert(canAccessCustomizationCategory({ permissionKeys: ['manage_staff', 'manage_training'] }, 'training'))
assert(canAccessCustomizationCategory({ permissionKeys: ['manage_bookings'] }, 'bookings'))

const dashboardPermissions: AuthorizationPermissionKey[] = [
  'manage_staff', 'manage_duty_roster', 'manage_training', 'manage_bookings',
  'manage_guest_occasions', 'manage_maintenance', 'manage_reports'
]
assert.equal(pagesFor(...dashboardPermissions)[0], 'Dashboard', 'The approved Dashboard remains the first module only when every card data source is authorized.')
assert(!pagesFor(...dashboardPermissions.filter(permission => permission !== 'manage_reports')).includes('Dashboard'), 'Dashboard must not appear with a confidential reporting permission gap.')

const appSource = await readFile('src/App.tsx', 'utf8')
const stylesSource = await readFile('src/styles.css', 'utf8')
assert.match(appSource, /accessiblePageSet\.has\(page\)/, 'Rendered modules must be guarded independently of navigation visibility.')
assert.match(appSource, /if \(!accessiblePageSet\.has\(destination\)\) return/, 'Direct navigation must reject unauthorized destinations.')
assert.doesNotMatch(appSource, /employeeMode/, 'The old binary employee mode must not suppress valid multi-role authorization.')
assert.match(appSource, /const initialPage = visibleNavigation\[0\]\?\.label/, 'The first authorized module must remain the employee landing page.')
assert.match(appSource, /<Dashboard employeeSafe=\{employeeSafeAccess\}/, 'Employees must reuse the approved main Dashboard component.')
assert.match(appSource, /staffAccessApi\.snapshot\(date\)/, 'The shared Dashboard must load only the employee-safe snapshot for staff accounts.')
assert.match(appSource, /<EmployeeSafeModule page=\{page\}/, 'Employee modules must render through the protected read-only module surface.')
assert.match(stylesSource, /\.app-sidebar nav\{[^}]*overflow-y:auto/s, 'The mobile navigation must remain scrollable.')
assert.match(stylesSource, /\.employee-safe-grid span,[^{]+\{[^}]*font-family:var\(--ao-font-ui\)/s, 'Employee-safe body text and numbers must use the approved UI font token.')

console.log(JSON.stringify({
  employeeSelfServiceIsolated: true,
  staffDependentModulesRequireStaffDirectoryPermission: true,
  mainDashboardComponentPreserved: true,
  reportPermissionMatchesBackend: true,
  financialPermissionSetVerified: true,
  customizationCategoriesPermissionFiltered: true,
  renderAndNavigationGuardsPresent: true,
  dashboardLandingAndReuseVerified: true,
  employeeSnapshotBindingVerified: true,
  mobileNavigationScrollVerified: true,
  employeeTypographyTokenVerified: true
}, null, 2))
