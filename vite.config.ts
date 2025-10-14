import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: 'js',
    rollupOptions: {
      input: 'src/blockchain.ts',
      output: {
        entryFileNames: 'bundle.js',
        format: 'iife' // For browser global
      }
    }
  }
});
