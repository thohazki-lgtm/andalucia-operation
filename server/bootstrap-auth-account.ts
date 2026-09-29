import { StaffRepository } from './staff-repository.js'
import { AuthService } from './auth-service.js'
import { openVerifiedDatabase, resolveRuntimeStore } from './database-protection.js'

const identifier = process.env.ANDALUCIA_BOOTSTRAP_IDENTIFIER || ''
const displayName = process.env.ANDALUCIA_BOOTSTRAP_DISPLAY_NAME || ''
const password = process.env.ANDALUCIA_BOOTSTRAP_PASSWORD || ''
if (!identifier || !displayName || !password) throw new Error('Set ANDALUCIA_BOOTSTRAP_IDENTIFIER, ANDALUCIA_BOOTSTRAP_DISPLAY_NAME and ANDALUCIA_BOOTSTRAP_PASSWORD for this explicit one-time command.')

const runtimeStore = resolveRuntimeStore()
const guarded = await openVerifiedDatabase({ dataDirectory: runtimeStore.dataDirectory, role: runtimeStore.role, requireOwner: false })
const repository = new StaffRepository(runtimeStore.dataDirectory, guarded.db)
try {
  await repository.assertCompatibleSchema()
  const account = await new AuthService(repository.getDatabase()).createFirstAccount({ identifier, displayName, password })
  console.log(`Platform account created: ${account.displayName} (${account.loginIdentifier}) [${account.userId}]`)
} finally { await repository.getDatabase().close() }
