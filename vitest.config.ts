import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
    // Backups of the user's connected folder live in data/ (see workspaceStore) — copies of
    // their *.test.* files must never be collected as this project's own tests.
    exclude: [...configDefaults.exclude, 'data/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
