import { defineConfig } from 'vite';

// Library build. Deliberately NOT vite lib mode: lib mode force-inlines assets,
// which would base64 ~24 MB of onnxruntime .wasm into asr-worker.js. A plain
// multi-entry ES build emits the wasm as separate files and rewrites all
// references relative to import.meta.url, so the package stays relocatable
// (npm, CDN, sub-path — anywhere).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: 'src/index.ts',
        element: 'src/element.ts',
        'readback-sre': 'src/readback-sre.ts',
      },
      // Optional peer deps for the SRE read-back tier only; everything else
      // (parser, transformers) is bundled.
      external: ['katex', 'speech-rule-engine'],
      preserveEntrySignatures: 'strict',
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    minify: false,
    sourcemap: true,
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'asr-worker.js',
        codeSplitting: false,
      },
    },
  },
});
