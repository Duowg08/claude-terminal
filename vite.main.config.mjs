import { defineConfig } from 'vite';
import path from 'node:path';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve('src/shared'),
      '@main': path.resolve('src/main'),
    },
  },
  build: {
    rollupOptions: {
      external: ['node-pty'],
    },
  },
});
