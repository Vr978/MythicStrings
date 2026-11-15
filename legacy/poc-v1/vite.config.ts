import { defineConfig } from 'vite';

// The Rapier "-compat" build inlines its WASM as base64, so no WASM plugin is needed.
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
});
