/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

// The Jev evaluation (spec 007 R9). It calls Jev for real, so it is never part of `npm test`.
export default defineConfig({
  test: { environment: 'node', include: ['eval/**/*.test.ts'], testTimeout: 120000 },
})
