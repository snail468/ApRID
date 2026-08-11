import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// dev server proxies API + subscription routes to the backend on :6601
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:6601',
      '/sub': 'http://localhost:6601',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
