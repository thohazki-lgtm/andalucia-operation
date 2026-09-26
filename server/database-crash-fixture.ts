import { PGlite } from '@electric-sql/pglite'

const dataDirectory = process.argv[2]
if (!dataDirectory) throw new Error('Crash fixture data directory is required.')
const db = new PGlite(dataDirectory)
await db.query('select 1')
console.log('DATABASE_CRASH_FIXTURE_READY')
setInterval(() => undefined, 60_000)
