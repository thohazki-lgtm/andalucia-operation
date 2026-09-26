import { runMigrationCommand } from './migration-store.js'

const command = process.argv[2]
if (!['preflight', 'status', 'migrate'].includes(command || '')) throw new Error('Use preflight, status, or migrate.')
const result = await runMigrationCommand(command as 'preflight' | 'status' | 'migrate')
console.log(JSON.stringify(result, null, 2))
