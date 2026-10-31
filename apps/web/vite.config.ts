import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in development too, so the httpOnly session cookie just works.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
