import type { AuthPrincipal, AuthorizationPermissionKey } from '../src/domain.js'
import { AuthorizationError, AuthorizationService } from './authorization-service.js'

export const employeeSelfServicePermissions = [
  'view_own_roster',
  'view_own_timesheet',
  'edit_own_timesheet',
  'confirm_own_timesheet_days',
  'submit_own_timesheet_month'
] as const satisfies readonly AuthorizationPermissionKey[]

export function requireLinkedStaffIdentity(principal: AuthPrincipal, requestedStaffId: string) {
  if (principal.staffId && principal.staffId === requestedStaffId) return principal.staffId
  throw new AuthorizationError('FORBIDDEN', 'The requested employee record is outside this account.')
}

export async function requireOwnWorkforcePermission(
  authorization: AuthorizationService,
  principal: AuthPrincipal,
  permission: typeof employeeSelfServicePermissions[number],
  outletScopeId: string,
  requestedStaffId: string
) {
  await authorization.requireOutletPermission(principal, permission, outletScopeId)
  requireLinkedStaffIdentity(principal, requestedStaffId)
  return principal
}
