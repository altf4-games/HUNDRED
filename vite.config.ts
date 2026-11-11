import { defineConfig } from 'vitest/config';

// Relative base so dist/ works on Vercel, GitHub Pages or any static host.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 7000 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
