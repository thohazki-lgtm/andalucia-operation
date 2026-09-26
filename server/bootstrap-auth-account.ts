import { StaffRepository } from './staff-repository.js'
import { AuthService } from './auth-service.js'

const identifier = process.env.ANDALUCIA_BOOTSTRAP_IDENTIFIER || ''
const displayName = process.env.ANDALUCIA_BOOTSTRAP_DISPLAY_NAME || ''
const password = process.env.ANDALUCIA_BOOTSTRAP_PASSWORD || ''
if (!identifier || !displayName || !password) throw new Error('Set ANDALUCIA_BOOTSTRAP_IDENTIFIER, ANDALUCIA_BOOTSTRAP_DISPLAY_NAME and ANDALUCIA_BOOTSTRAP_PASSWORD for this explicit one-time command.')

const repository = new StaffRepository()
try {
  await repository.assertCompatibleSchema()
  const account = await new AuthService(repository.getDatabase()).createFirstAccount({ identifier, displayName, password })
  console.log(`Platform account created: ${account.displayName} (${account.loginIdentifier}) [${account.userId}]`)
} finally { await repository.getDatabase().close() }
