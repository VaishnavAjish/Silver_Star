import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Test-only config. Kept separate from vite.config.js so the production build
// (and its dev-server proxy setup) is untouched by test tooling.
// JSX is handled by esbuild's automatic runtime rather than @vitejs/plugin-react:
// the plugin's transform is not applied under this vitest/vite pairing.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@':         fileURLToPath(new URL('./src', import.meta.url)),
      '@modules':  fileURLToPath(new URL('./src/modules', import.meta.url)),
      '@shared':   fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@core':     fileURLToPath(new URL('./src/core', import.meta.url)),
      '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    css: false,
  },
});
