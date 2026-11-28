import type { AuthenticatedUser, AuthorizationPermissionKey } from './domain'

export type ApplicationPage =
  | 'Dashboard'
  | 'Staff Management'
  | 'Duty Roster'
  | 'Leave Planner'
  | 'Training'
  | 'Bookings'
  | 'Guest Occasions'
  | 'Incentives & Bill Tips'
  | 'Maintenance'
  | 'Reports'
  | 'Customization Center'
  | 'My Timesheet'

const dashboardPermissions: AuthorizationPermissionKey[] = [
  'manage_staff', 'manage_duty_roster', 'manage_training', 'manage_bookings',
  'manage_guest_occasions', 'manage_maintenance', 'manage_reports'
]

export const hasPermission = (user: Pick<AuthenticatedUser, 'permissionKeys'>, permission: AuthorizationPermissionKey) => user.permissionKeys.includes(permission)
export const hasEveryPermission = (user: Pick<AuthenticatedUser, 'permissionKeys'>, permissions: AuthorizationPermissionKey[]) => permissions.every(permission => hasPermission(user, permission))

export function accessibleApplicationPages(user: Pick<AuthenticatedUser, 'permissionKeys'>): ApplicationPage[] {
  const pages: ApplicationPage[] = []
  const hasStaffDirectory = hasPermission(user, 'manage_staff')
  if (hasEveryPermission(user, dashboardPermissions) || hasPermission(user, 'view_staff_dashboard')) pages.push('Dashboard')
  if (hasStaffDirectory || hasPermission(user, 'view_staff_directory')) pages.push('Staff Management')
  if (hasStaffDirectory && hasPermission(user, 'manage_duty_roster') || hasPermission(user, 'view_own_roster')) pages.push('Duty Roster')
  if (hasStaffDirectory && hasPermission(user, 'manage_duty_roster') || hasPermission(user, 'view_own_leave')) pages.push('Leave Planner')
  if (hasStaffDirectory && hasPermission(user, 'manage_training') || hasPermission(user, 'view_staff_training')) pages.push('Training')
  if (hasStaffDirectory && hasPermission(user, 'manage_bookings') || hasPermission(user, 'view_service_bookings')) pages.push('Bookings')
  if (hasStaffDirectory && hasPermission(user, 'manage_guest_occasions') || hasPermission(user, 'view_guest_occasions')) pages.push('Guest Occasions')
  if (hasStaffDirectory && hasEveryPermission(user, ['manage_chargeables', 'manage_bill_tips', 'manage_incentives']) || hasPermission(user, 'view_own_earnings')) pages.push('Incentives & Bill Tips')
  if (hasStaffDirectory && hasPermission(user, 'manage_maintenance') || hasPermission(user, 'view_maintenance')) pages.push('Maintenance')
  if (hasPermission(user, 'manage_reports') || hasPermission(user, 'view_staff_reports')) pages.push('Reports')
  if ((Object.keys(customizationCategoryPermissions) as CustomizationCategory[]).some(category => canAccessCustomizationCategory(user, category))) pages.push('Customization Center')
  if (hasPermission(user, 'view_own_timesheet')) pages.push('My Timesheet')
  return pages
}

export const customizationCategoryPermissions = {
  bookings: 'manage_bookings',
  training: 'manage_training',
  'guest-experience': 'manage_guest_occasions',
  commercial: 'manage_chargeables',
  maintenance: 'manage_maintenance'
} as const satisfies Record<string, AuthorizationPermissionKey>

export type CustomizationCategory = keyof typeof customizationCategoryPermissions
export const canAccessCustomizationCategory = (user: Pick<AuthenticatedUser, 'permissionKeys'>, category: CustomizationCategory) => hasPermission(user, customizationCategoryPermissions[category]) && (category !== 'training' || hasPermission(user, 'manage_staff'))
