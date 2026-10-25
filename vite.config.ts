/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handleConfirm, handleStatus } from './src/jev/proxy'

// Jev through the dev server only (spec 007): the key stays in this process, and a built page has no
// /api/jev at all, so it falls back to the rules.
const jevProxy = (): Plugin => ({
  name: 'jev-proxy',
  apply: 'serve',
  configureServer(server) {
    const env = () => ({ TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY, JEV_ENABLED: process.env.JEV_ENABLED })
    server.middlewares.use('/api/jev', async (req, res) => {
      const send = ({ status, body }: { status: number; body: unknown }) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(body))
      }
      if (req.method === 'GET' && req.url === '/status') return send(handleStatus(env()))
      if (req.method !== 'POST' || req.url !== '/confirm') return send({ status: 404, body: { error: 'not found' } })
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > 2_000_000) return send({ status: 413, body: { error: 'request too large' } })
      }
      let body: unknown
      try {
        body = JSON.parse(raw)
      } catch {
        return send({ status: 400, body: { error: 'expected JSON' } })
      }
      send(await handleConfirm(body, env(), fetch))
    })
  },
})

export default defineConfig({
  plugins: [react(), jevProxy()],
  base: './', // relative asset paths, so the built app also runs as a published artifact
  server: { port: 5173, strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
