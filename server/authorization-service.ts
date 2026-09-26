import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
import type { AuditActor, AuthPrincipal, AuthorizationPermission, AuthorizationPermissionKey, AuthorizationRole, AuthorizationRoleKey, AuthorizationSummary } from '../src/domain.js'

const systemActor = 'Authorization system initialization'
const roleDefinitions: AuthorizationRole[] = [
  { id: '00000000-0000-4000-8000-000000001001', key: 'owner', displayName: 'Owner / Super Admin', active: true, globalScope: true },
  { id: '00000000-0000-4000-8000-000000001002', key: 'outlet_manager', displayName: 'Outlet Manager', active: true, globalScope: false },
  { id: '00000000-0000-4000-8000-000000001003', key: 'operational_user', displayName: 'Operational User', active: true, globalScope: false },
  { id: '00000000-0000-4000-8000-000000001004', key: 'viewer', displayName: 'Viewer', active: true, globalScope: false }
]
const permissionNames: Array<[AuthorizationPermissionKey, string, string]> = [
  ['manage_platform', 'Manage Platform', 'Administer supported platform-wide settings.'],
  ['manage_outlets', 'Manage Outlets', 'Create and administer outlet scopes.'],
  ['manage_users', 'Manage Users', 'Administer platform user accounts.'],
  ['manage_roles_permissions', 'Manage Roles and Permissions', 'Administer authorization assignments.'],
  ['manage_staff', 'Manage Staff', 'Create and maintain Staff records.'],
  ['manage_staff_membership', 'Manage Staff Membership', 'Maintain outlet membership history.'],
  ['manage_staff_membership_baseline', 'Manage Staff Membership Baseline', 'Begin and edit a baseline review.'],
  ['approve_staff_membership_baseline', 'Approve Staff Membership Baseline', 'Approve an outlet baseline review.'],
  ['reopen_staff_membership_baseline', 'Reopen Staff Membership Baseline', 'Use a future controlled baseline correction workflow.'],
  ['manage_duty_roster', 'Manage Duty Roster', 'Maintain outlet duty rosters.'],
  ['manage_training', 'Manage Training', 'Maintain training sessions and imports.'],
  ['manage_bookings', 'Manage Bookings', 'Maintain restaurant bookings and imports.'],
  ['manage_guest_occasions', 'Manage Guest Occasions', 'Maintain guest-occasion workflows.'],
  ['manage_chargeables', 'Manage Chargeable Items', 'Maintain chargeable-item workflows.'],
  ['manage_maintenance', 'Manage Maintenance', 'Maintain operational maintenance records.'],
  ['manage_bill_tips', 'Manage Bill Tips', 'Administer future Bill Tip workflows.'],
  ['manage_incentives', 'Manage Incentives', 'Administer incentive workflows.'],
  ['manage_financial_rules', 'Manage Financial Rules', 'Administer protected financial policy versions.'],
  ['view_reports', 'View Reports', 'View operational reports.'],
  ['manage_reports', 'Manage Reports', 'Maintain report commentary and settings.'],
  ['view_audit_history', 'View Audit History', 'View supported audit and history records.'],
  ['perform_financial_corrections', 'Perform Financial Corrections', 'Use controlled financial correction and reversal workflows.']
]
const permissionDefinitions: AuthorizationPermission[] = permissionNames.map(([key, displayName, description], index) => ({ id: `00000000-0000-4000-8000-${String(2001 + index).padStart(12, '0')}`, key, displayName, description, active: true }))
const initialRolePermissions: Record<Exclude<AuthorizationRoleKey, 'owner'>, AuthorizationPermissionKey[]> = {
  outlet_manager: ['manage_staff', 'manage_staff_membership', 'manage_staff_membership_baseline', 'approve_staff_membership_baseline', 'manage_duty_roster', 'manage_training', 'manage_bookings', 'manage_guest_occasions', 'manage_chargeables', 'manage_maintenance', 'view_reports', 'manage_reports'],
  operational_user: ['manage_training', 'manage_bookings', 'manage_guest_occasions', 'manage_chargeables', 'manage_maintenance'],
  viewer: ['view_reports']
}

export class AuthorizationError extends Error {
  readonly status = 403
  constructor(public readonly code: 'FORBIDDEN' | 'INSUFFICIENT_PERMISSION' | 'OUTLET_SCOPE_NOT_ALLOWED' | 'OWNER_ACCOUNT_NOT_CONFIGURED' | 'LAST_OWNER_REMOVAL', message: string) { super(message) }
}

export const auditActorLabel = (actor: AuditActor) => `${actor.displayName} [${actor.userId}]`

export class AuthorizationService {
  constructor(private readonly db: PGlite) {}

  async initialize() {
    await this.db.transaction(async transaction => {
      const newlyCreatedRoles = new Set<AuthorizationRoleKey>()
      for (const role of roleDefinitions) {
        const inserted = await transaction.query('insert into authorization_roles(id,role_key,display_name,active,global_scope,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$6) on conflict(role_key) do nothing returning id', [role.id, role.key, role.displayName, role.active, role.globalScope, systemActor])
        if (inserted.rows[0]) newlyCreatedRoles.add(role.key)
      }
      for (const permission of permissionDefinitions) await transaction.query('insert into authorization_permissions(id,permission_key,display_name,description,active,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$6) on conflict(permission_key) do nothing', [permission.id, permission.key, permission.displayName, permission.description, permission.active, systemActor])
      for (const [roleKey, permissions] of Object.entries(initialRolePermissions) as Array<[Exclude<AuthorizationRoleKey, 'owner'>, AuthorizationPermissionKey[]]>) {
        if (!newlyCreatedRoles.has(roleKey)) continue
        const role = roleDefinitions.find(item => item.key === roleKey)!
        for (const permissionKey of permissions) {
          const permission = permissionDefinitions.find(item => item.key === permissionKey)!
          await transaction.query('insert into authorization_role_permissions(role_id,permission_id,created_by) values($1,$2,$3) on conflict(role_id,permission_id) do nothing', [role.id, permission.id, systemActor])
        }
      }
    })
  }

  async roles(): Promise<AuthorizationRole[]> {
    const result = await this.db.query<any>('select id,role_key,display_name,active,global_scope from authorization_roles order by global_scope desc,display_name')
    return result.rows.map(row => ({ id: row.id, key: row.role_key, displayName: row.display_name, active: row.active, globalScope: row.global_scope }))
  }

  async permissions(): Promise<AuthorizationPermission[]> {
    const result = await this.db.query<any>('select id,permission_key,display_name,description,active from authorization_permissions order by permission_key')
    return result.rows.map(row => ({ id: row.id, key: row.permission_key, displayName: row.display_name, description: row.description, active: row.active }))
  }

  async authorizationForUser(userId: string): Promise<AuthorizationSummary> {
    const roleResult = await this.db.query<any>('select r.id,r.role_key,r.global_scope from authorization_user_roles ur join authorization_roles r on r.id=ur.role_id where ur.user_id=$1 and ur.active=true and r.active=true order by r.role_key', [userId])
    const roleKeys = roleResult.rows.map(row => row.role_key) as AuthorizationRoleKey[]
    const globalScope = roleResult.rows.some(row => row.global_scope)
    const permissionResult = globalScope
      ? await this.db.query<any>('select permission_key from authorization_permissions where active=true order by permission_key')
      : await this.db.query<any>('select distinct p.permission_key from authorization_user_roles ur join authorization_roles r on r.id=ur.role_id and r.active=true join authorization_role_permissions rp on rp.role_id=r.id join authorization_permissions p on p.id=rp.permission_id and p.active=true where ur.user_id=$1 and ur.active=true order by p.permission_key', [userId])
    const outlets = await this.db.query<{ outlet_scope_id: string }>('select uo.outlet_scope_id from authorization_user_outlet_scopes uo join outlet_scopes o on o.id=uo.outlet_scope_id where uo.user_id=$1 and uo.active=true and o.active=true order by uo.outlet_scope_id', [userId])
    return { roleKeys, permissionKeys: permissionResult.rows.map(row => row.permission_key) as AuthorizationPermissionKey[], globalScope, allowedOutletScopeIds: outlets.rows.map(row => row.outlet_scope_id), isOwner: roleKeys.includes('owner') }
  }

  async assignRole(userId: string, roleKey: AuthorizationRoleKey, actor: AuditActor) {
    const user = await this.db.query('select id from user_accounts where id=$1', [userId]); if (!user.rows[0]) throw new AuthorizationError('OWNER_ACCOUNT_NOT_CONFIGURED', 'The target platform account was not found.')
    const role = await this.db.query<{ id: string }>('select id from authorization_roles where role_key=$1 and active=true', [roleKey]); if (!role.rows[0]) throw new AuthorizationError('FORBIDDEN', 'The selected authorization role is unavailable.')
    const existing = await this.db.query<any>('select id,active from authorization_user_roles where user_id=$1 and role_id=$2', [userId, role.rows[0].id])
    if (existing.rows[0]?.active) return this.authorizationForUser(userId)
    await this.db.transaction(async transaction => {
      await transaction.query('insert into authorization_user_roles(id,user_id,role_id,active,created_by,updated_by) values($1,$2,$3,true,$4,$4) on conflict(user_id,role_id) do update set active=true,updated_by=excluded.updated_by,updated_at=now()', [randomUUID(), userId, role.rows[0].id, actor.userId])
      await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'role_assigned',true,$3,$4)", [randomUUID(), userId, JSON.stringify({ roleKey, actorDisplayName: actor.displayName }), actor.userId])
    })
    return this.authorizationForUser(userId)
  }

  async promoteOwner(userId: string, actor: AuditActor) {
    const before = await this.authorizationForUser(userId)
    const authorization = await this.assignRole(userId, 'owner', actor)
    if (!before.isOwner) await this.db.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'owner_promoted',true,$3,$4)", [randomUUID(), userId, JSON.stringify({ roleKey: 'owner', actorDisplayName: actor.displayName }), actor.userId])
    return authorization
  }

  async removeRole(userId: string, roleKey: AuthorizationRoleKey, actor: AuditActor) {
    const role = await this.db.query<{ id: string }>('select id from authorization_roles where role_key=$1', [roleKey]); if (!role.rows[0]) return this.authorizationForUser(userId)
    if (roleKey === 'owner') {
      const owners = await this.db.query<{ count: number }>("select count(*)::int count from authorization_user_roles ur join authorization_roles r on r.id=ur.role_id where r.role_key='owner' and r.active=true and ur.active=true")
      const target = await this.db.query('select id from authorization_user_roles where user_id=$1 and role_id=$2 and active=true', [userId, role.rows[0].id])
      if (target.rows[0] && Number(owners.rows[0].count) <= 1) throw new AuthorizationError('LAST_OWNER_REMOVAL', 'The only active Owner account cannot be demoted.')
    }
    const updated = await this.db.query<any>('update authorization_user_roles set active=false,updated_by=$3,updated_at=now() where user_id=$1 and role_id=$2 and active=true returning id', [userId, role.rows[0].id, actor.userId])
    if (updated.rows[0]) await this.db.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'role_removed',true,$3,$4)", [randomUUID(), userId, JSON.stringify({ roleKey, actorDisplayName: actor.displayName }), actor.userId])
    return this.authorizationForUser(userId)
  }

  async assignOutlet(userId: string, outletScopeId: string, actor: AuditActor) {
    const user = await this.db.query('select id from user_accounts where id=$1', [userId]); const outlet = await this.db.query('select id from outlet_scopes where id=$1', [outletScopeId])
    if (!user.rows[0] || !outlet.rows[0]) throw new AuthorizationError('OUTLET_SCOPE_NOT_ALLOWED', 'The selected user or outlet scope was not found.')
    const existing = await this.db.query<any>('select id,active from authorization_user_outlet_scopes where user_id=$1 and outlet_scope_id=$2', [userId, outletScopeId])
    if (existing.rows[0]?.active) return this.authorizationForUser(userId)
    await this.db.transaction(async transaction => {
      await transaction.query('insert into authorization_user_outlet_scopes(id,user_id,outlet_scope_id,active,created_by,updated_by) values($1,$2,$3,true,$4,$4) on conflict(user_id,outlet_scope_id) do update set active=true,updated_by=excluded.updated_by,updated_at=now()', [randomUUID(), userId, outletScopeId, actor.userId])
      await transaction.query("insert into auth_security_events(id,user_id,event_type,success,details,actor_user_id) values($1,$2,'outlet_scope_assigned',true,$3,$4)", [randomUUID(), userId, JSON.stringify({ outletScopeId, actorDisplayName: actor.displayName }), actor.userId])
    })
    return this.authorizationForUser(userId)
  }

  async requirePermission(principal: AuthPrincipal, permission: AuthorizationPermissionKey) {
    if (principal.permissionKeys.includes(permission)) return principal
    await this.denied(principal, 'INSUFFICIENT_PERMISSION', { permission })
    throw new AuthorizationError('INSUFFICIENT_PERMISSION', `Permission ${permission} is required.`)
  }

  async requireOutletPermission(principal: AuthPrincipal, permission: AuthorizationPermissionKey, outletScopeId: string) {
    await this.requirePermission(principal, permission)
    if (principal.globalScope || principal.allowedOutletScopeIds.includes(outletScopeId)) return principal
    await this.denied(principal, 'OUTLET_SCOPE_NOT_ALLOWED', { permission, outletScopeId })
    throw new AuthorizationError('OUTLET_SCOPE_NOT_ALLOWED', 'This account is not authorized for the requested outlet scope.')
  }

  private async denied(principal: AuthPrincipal, code: string, details: Record<string, unknown>) {
    await this.db.query("insert into auth_security_events(id,user_id,session_id,event_type,success,details,actor_user_id) values($1,$2,$3,'authorization_denied',false,$4,$2)", [randomUUID(), principal.userId, principal.sessionId, JSON.stringify({ code, ...details })])
  }
}

export { initialRolePermissions, permissionDefinitions, roleDefinitions }
