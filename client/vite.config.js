import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@':          fileURLToPath(new URL('./src',          import.meta.url)),
      '@modules':   fileURLToPath(new URL('./src/modules',  import.meta.url)),
      '@shared':    fileURLToPath(new URL('./src/shared',   import.meta.url)),
      '@core':      fileURLToPath(new URL('./src/core',     import.meta.url)),
      '@features':  fileURLToPath(new URL('./src/features', import.meta.url)),
    },
    preserveSymlinks: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        xfwd: true,
        proxyTimeout: 35000,   // 35s — slightly above server request timeout
        timeout: 35000,
        cookieDomainRewrite: { '*': '' }, // strip cookie domain so browser keeps it for its own origin
        cookiePathRewrite: { '*': '/' },
      },
      '/socket.io': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: false,
        ws: true,
      },
    },
    fs: { strict: false },
    watch: { usePolling: true },
  },
});

