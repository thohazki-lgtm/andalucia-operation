import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
