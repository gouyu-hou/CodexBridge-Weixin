import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [react()],
  build: {
    assetsDir: '.',
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: path.join(rootDir, 'src/platforms/weixin/admin_app/main.tsx'),
      formats: ['iife'],
      name: 'CodexBridgeWeixinAdmin',
    },
    minify: 'esbuild',
    modulePreload: false,
    rollupOptions: {
      output: {
        assetFileNames: 'admin.css',
        entryFileNames: 'admin.js',
        inlineDynamicImports: true,
      },
    },
    sourcemap: false,
    target: 'es2023',
  },
});
