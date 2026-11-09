import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { connect, createServer } from 'node:net'
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

const localhostIpv6Bridge = (): Plugin => ({
  name: 'andalucia-localhost-ipv6-bridge',
  configureServer(server) {
    const port = server.config.server.port || 5173
    const bridge = createServer(client => {
      const upstream = connect({ host: '127.0.0.1', port })
      client.pipe(upstream)
      upstream.pipe(client)
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => client.destroy())
    })
    bridge.listen(port, '::1')
    server.httpServer?.once('close', () => bridge.close())
  }
})

export default defineConfig({
  plugins: [react(), gracefulFrontendShutdown(), localhostIpv6Bridge()],
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
