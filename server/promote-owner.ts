import { StaffRepository } from './staff-repository.js'
import { OutletMembershipRepository } from './outlet-membership-repository.js'
import { AuthorizationService } from './authorization-service.js'

const userId = process.env.PLATFORM_OWNER_USER_ID?.trim()
const identifier = process.env.PLATFORM_OWNER_IDENTIFIER?.normalize('NFKC').trim().toLowerCase()
if (Boolean(userId) === Boolean(identifier)) throw new Error('Provide exactly one of PLATFORM_OWNER_USER_ID or PLATFORM_OWNER_IDENTIFIER.')

const repository = new StaffRepository()
try {
  await repository.assertCompatibleSchema()
  const db = repository.getDatabase()
  const outlets = new OutletMembershipRepository(db); await outlets.initialize()
  const authorization = new AuthorizationService(db); await authorization.initialize()
  const result = userId
    ? await db.query<any>('select id,login_identifier,display_name,status from user_accounts where id=$1', [userId])
    : await db.query<any>('select id,login_identifier,display_name,status from user_accounts where normalized_login_identifier=$1', [identifier])
  if (result.rows.length !== 1) throw new Error('OWNER_ACCOUNT_NOT_CONFIGURED: the explicit target account was not found or was ambiguous.')
  const account = result.rows[0]
  if (account.status !== 'active') throw new Error('OWNER_ACCOUNT_NOT_CONFIGURED: the explicit target account is disabled.')
  const actor = { userId: account.id, displayName: account.display_name }
  const promoted = await authorization.promoteOwner(account.id, actor)
  console.log(JSON.stringify({ userId: account.id, loginIdentifier: account.login_identifier, displayName: account.display_name, owner: promoted.isOwner, globalScope: promoted.globalScope }, null, 2))
} finally { await repository.getDatabase().close() }
