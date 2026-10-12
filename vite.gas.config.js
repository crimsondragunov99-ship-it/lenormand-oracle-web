import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(root, 'src/main.jsx'),
      name: 'LenormandOracle',
      formats: ['iife'],
      fileName: () => 'AppBundle.js',
    },
    cssCodeSplit: false,
    outDir: resolve(root, 'gas-prototype/generated'),
    emptyOutDir: true,
  },
});
