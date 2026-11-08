import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type GuardedStartupHealth = {
  sha: string
  branch: string
  storeId: string
  schema: string
  databaseStatus: string
}

const safeDetail = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()

export const appendGuardedStartupRecord = (logPath: string, state: string, detail: string) => {
  mkdirSync(dirname(logPath), { recursive: true })
  appendFileSync(logPath, `${JSON.stringify({
    version: 'andalucia-guarded-startup-v1',
    recordedAt: new Date().toISOString(),
    state,
    detail: safeDetail(detail)
  })}\n`, { encoding: 'utf8' })
}

export const acknowledgeGuardedStartupHealth = (health: GuardedStartupHealth, logPath = process.env.ANDALUCIA_GUARDED_STARTUP_LOG) => {
  if (!logPath) return false
  appendGuardedStartupRecord(logPath, 'HEALTH_ACKNOWLEDGED', `sha=${health.sha};branch=${health.branch};storeId=${health.storeId};schema=${health.schema};databaseStatus=${health.databaseStatus}`)
  return true
}
