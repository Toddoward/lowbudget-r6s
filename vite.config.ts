import { defineConfig } from 'vite';
import { editorApi } from './tools/editor/plugin.ts';

// Static SPA for Cloudflare Pages. The room/signaling backend lives in /worker
// (Durable Object) and is reached through the Pages Function at /api/room/:code.
export default defineConfig({
  base: './',
  // the editor's file API (dev server only: `npm run editor`)
  plugins: [editorApi()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // `npm run dev:worker` serves the Durable Object locally on :8787
      '/api': { target: 'http://127.0.0.1:8787', ws: true, changeOrigin: true },
    },
  },
});
