/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Cesium loads its workers and assets from here (public/cesium -> node_modules/cesium/Build/Cesium).
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium') },
  // File-change events don't reliably cross the Docker bind mount on macOS, so poll there
  // (docker-compose.yml sets VITE_POLL). Outside Docker, use normal file events.
  server: { watch: { usePolling: !!process.env.VITE_POLL, interval: 1000 } },
  test: {
    environment: 'jsdom',
    coverage: {
      include: ['src/**/*.{ts,tsx}'],
      thresholds: { lines: 90 }, // keep in sync with the CI coverage gate
    },
  },
})
