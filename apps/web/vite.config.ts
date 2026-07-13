import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any path — including
  // GitHub Pages' /VoxTeX/ subpath — without a per-host config.
  base: './',
  plugins: [react()],
  optimizeDeps: {
    // The SDK ships a prebuilt self-contained worker; pre-bundling would
    // break its relative asset references.
    exclude: ['@voxtex/voice-math-input'],
  },
  build: {
    target: 'es2022',
  },
});
