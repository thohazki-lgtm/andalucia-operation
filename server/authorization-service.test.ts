import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { AuthService } from './auth-service.js'
import { auditActorLabel, AuthorizationError, AuthorizationService } from './authorization-service.js'
import { StaffMembershipBaselineService } from './staff-membership-baseline-service.js'

const folder = await mkdtemp(join(tmpdir(), 'andalucia-authorization-'))
const db = new PGlite(join(folder, 'postgres'))
try {
  await db.exec(await readFile('database/schema.sql', 'utf8'))
  const authorization = new AuthorizationService(db); await authorization.initialize(); await authorization.initialize()
  const auth = new AuthService(db, authorization)
  const andaluciaId = '00000000-0000-4000-8000-00000000a001'; const futureOutletId = randomUUID()
  await db.query("insert into outlet_scopes(id,scope_key,display_name,active,outlet_type) values($1,'andalucia','Andalucía',true,'restaurant'),($2,'future_pool_bar','Future Pool Bar',true,'pool_bar')", [andaluciaId, futureOutletId])

  const owner = await auth.createFirstAccount({ identifier: 'platform.owner', displayName: 'Platform Owner', password: 'OwnerPassword2026' })
  const ownerActor = { userId: owner.userId, displayName: owner.displayName }
  const firstPromotion = await authorization.promoteOwner(owner.userId, ownerActor); const secondPromotion = await authorization.promoteOwner(owner.userId, ownerActor)
  assert.equal(firstPromotion.isOwner, true); assert.deepEqual(secondPromotion, firstPromotion)
  assert.equal(Number((await db.query<{ count: number }>("select count(*)::int count from authorization_user_roles ur join authorization_roles r on r.id=ur.role_id where ur.user_id=$1 and r.role_key='owner'", [owner.userId])).rows[0].count), 1)

  const manager = await auth.createAccount({ identifier: 'outlet.manager', displayName: 'Outlet Manager', password: 'ManagerPassword2026' }, ownerActor)
  const viewer = await auth.createAccount({ identifier: 'read.viewer', displayName: 'Read Viewer', password: 'ViewerPassword2026' }, ownerActor)
  const operational = await auth.createAccount({ identifier: 'operations.user', displayName: 'Operations User', password: 'OperationsPassword2026' }, ownerActor)
  await authorization.assignRole(manager.userId, 'outlet_manager', ownerActor); await authorization.assignOutlet(manager.userId, andaluciaId, ownerActor)
  await authorization.assignRole(viewer.userId, 'viewer', ownerActor); await authorization.assignOutlet(viewer.userId, andaluciaId, ownerActor)
  await authorization.assignRole(operational.userId, 'operational_user', ownerActor); await authorization.assignOutlet(operational.userId, andaluciaId, ownerActor)

  const ownerSession = await auth.login('platform.owner', 'OwnerPassword2026'); const ownerPrincipal = (await auth.principalForToken(ownerSession.token))!
  const managerSession = await auth.login('outlet.manager', 'ManagerPassword2026'); const managerPrincipal = (await auth.principalForToken(managerSession.token))!
  const viewerSession = await auth.login('read.viewer', 'ViewerPassword2026'); const viewerPrincipal = (await auth.principalForToken(viewerSession.token))!
  const operationalSession = await auth.login('operations.user', 'OperationsPassword2026'); const operationalPrincipal = (await auth.principalForToken(operationalSession.token))!

  assert.equal(ownerPrincipal.globalScope, true); assert.equal(ownerPrincipal.allowedOutletScopeIds.length, 0); assert(ownerPrincipal.permissionKeys.includes('manage_platform'))
  await authorization.requireOutletPermission(ownerPrincipal, 'approve_staff_membership_baseline', andaluciaId)
  await authorization.requireOutletPermission(ownerPrincipal, 'reopen_staff_membership_baseline', andaluciaId)
  await authorization.requireOutletPermission(ownerPrincipal, 'approve_staff_membership_baseline', futureOutletId)
  await authorization.requireOutletPermission(managerPrincipal, 'manage_staff_membership_baseline', andaluciaId)
  await assert.rejects(() => authorization.requireOutletPermission(managerPrincipal, 'reopen_staff_membership_baseline', andaluciaId), (error: unknown) => error instanceof AuthorizationError && error.code === 'INSUFFICIENT_PERMISSION')
  await assert.rejects(() => authorization.requireOutletPermission(managerPrincipal, 'manage_staff_membership_baseline', futureOutletId), (error: unknown) => error instanceof AuthorizationError && error.code === 'OUTLET_SCOPE_NOT_ALLOWED')
  await assert.rejects(() => authorization.requireOutletPermission(viewerPrincipal, 'manage_staff_membership_baseline', andaluciaId), (error: unknown) => error instanceof AuthorizationError && error.code === 'INSUFFICIENT_PERMISSION')
  await assert.rejects(() => authorization.requireOutletPermission(operationalPrincipal, 'approve_staff_membership_baseline', andaluciaId), (error: unknown) => error instanceof AuthorizationError && error.code === 'INSUFFICIENT_PERMISSION')
  await assert.rejects(() => authorization.removeRole(owner.userId, 'owner', ownerActor), (error: unknown) => error instanceof AuthorizationError && error.code === 'LAST_OWNER_REMOVAL')

  assert.equal(ownerPrincipal.userId, owner.userId); assert.equal(ownerPrincipal.isOwner, true)
  assert.notEqual((await auth.principalForToken(managerSession.token))?.isOwner, true)
  const roles = await authorization.roles(); const permissions = await authorization.permissions()
  assert.equal(roles.length, 4); assert.equal(permissions.length, 22)
  await assert.rejects(() => db.query("update authorization_roles set role_key='renamed_owner' where role_key='owner'"), /immutable/i)
  await assert.rejects(() => db.query("update authorization_permissions set permission_key='renamed_permission' where permission_key='manage_platform'"), /immutable/i)

  const staffId = randomUUID()
  await db.query("insert into staff(id,staff_number,full_name,position_key,employment_status_key,join_date,nationality,division,department,outlet,identity_document_number) values($1,'AUTH-001','Authorization Test Staff','Waiter','active','2026-01-01','','Food & Beverage','F&B Service','Andalucía','')", [staffId])
  const baseline = new StaffMembershipBaselineService(db)
  await authorization.requireOutletPermission(ownerPrincipal, 'manage_staff_membership_baseline', andaluciaId)
  const review = await baseline.beginReview('2026-09', 'andalucia', auditActorLabel(ownerPrincipal))
  await baseline.saveSelection(review.id, { staffId, included: true, effectiveFrom: '2026-09-01', effectiveTo: null }, auditActorLabel(ownerPrincipal))
  await assert.rejects(() => authorization.requireOutletPermission(viewerPrincipal, 'approve_staff_membership_baseline', andaluciaId), (error: unknown) => error instanceof AuthorizationError)
  await authorization.requireOutletPermission(ownerPrincipal, 'approve_staff_membership_baseline', andaluciaId)
  const approved = await baseline.approve(review.id, auditActorLabel(ownerPrincipal)); assert.equal(approved.status, 'BASELINE_APPROVED')
  assert.match(approved.review.approvedBy || '', new RegExp(owner.userId))

  const events = await db.query<any>("select event_type,user_id,actor_user_id,details from auth_security_events where event_type in ('role_assigned','owner_promoted','outlet_scope_assigned','authorization_denied')")
  assert(events.rows.some(row => row.event_type === 'owner_promoted' && row.user_id === owner.userId && row.actor_user_id === owner.userId))
  assert(events.rows.some(row => row.event_type === 'authorization_denied'))
  console.log(JSON.stringify({ rolesSeeded: 4, permissionsSeeded: 22, ownerPromotionIdempotent: true, ownerGlobalWithoutOutletRows: true, outletManagerAndaluciaAllowed: true, manipulatedOutletDenied: true, viewerMutationDenied: true, operationalApprovalDenied: true, lastOwnerRemovalBlocked: true, trustedClaims: true, authorizationAudit: true, isolatedBaselineWorkflow: true }, null, 2))
} finally { await db.close(); await rm(folder, { recursive: true, force: true }) }
