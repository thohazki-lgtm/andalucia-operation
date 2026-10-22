import { existsSync } from 'node:fs'

export type DatabaseSafeShutdownOptions = {
  closeHttpServer: () => Promise<void>
  closeDatabase: () => Promise<void>
  stopBackgroundTasks: () => void
  processMarkerPath: string
  markerReleaseTimeoutMs?: number
  markerReleasePollMs?: number
}

const waitForMarkerRelease = async (path: string, timeoutMs: number, pollMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (existsSync(path) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, pollMs))
  if (existsSync(path)) throw new Error('DATABASE_PROCESS_MARKER_REMAINS_AFTER_CLOSE')
}

export const createDatabaseSafeShutdown = (options: DatabaseSafeShutdownOptions) => {
  let shutdown: Promise<void> | null = null
  return (_reason: string) => {
    if (shutdown) return shutdown
    shutdown = (async () => {
      options.stopBackgroundTasks()
      await options.closeHttpServer()
      await options.closeDatabase()
      await waitForMarkerRelease(options.processMarkerPath, options.markerReleaseTimeoutMs ?? 5_000, options.markerReleasePollMs ?? 50)
    })()
    return shutdown
  }
}
