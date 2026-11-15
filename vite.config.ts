import { defineConfig } from 'vite';

// The client is a static bundle. In development the API and the WebSocket are proxied to the
// Node server on :8787, so the browser talks to one origin exactly as it does in production.
const SERVER = process.env.MYTHIC_SERVER ?? 'http://127.0.0.1:8787';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
