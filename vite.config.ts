import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const runtimeDirectory = join(process.cwd(), '.runtime')
const gracefulShutdownRequest = join(runtimeDirectory, 'frontend-shutdown.request')

const gracefulFrontendShutdown = () => ({
  name: 'andalucia-graceful-frontend-shutdown',
  configureServer(server: { close: () => Promise<void>; httpServer: { once: (event: string, callback: () => void) => void } | null }) {
    mkdirSync(runtimeDirectory, { recursive: true })
    if (existsSync(gracefulShutdownRequest)) unlinkSync(gracefulShutdownRequest)
    const timer = setInterval(async () => {
      if (!existsSync(gracefulShutdownRequest)) return
      clearInterval(timer)
      await server.close()
      process.exit(0)
    }, 250)
    server.httpServer?.once('close', () => clearInterval(timer))
  }
})

export default defineConfig({
  plugins: [react(), gracefulFrontendShutdown()],
  server: {
    watch: {
      ignored: [
        '**/.data/**',
        '**/.backups/**',
        '**/.recovery/**',
        '**/.tmp/**',
        '**/.tmp-*/**',
        '**/.tools/**',
        '**/.npm-cache/**',
        '**/.pnpm-store/**',
        '**/sources/**',
        '**/dist/**'
      ]
    },
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT || 3001}` }
  }
})
