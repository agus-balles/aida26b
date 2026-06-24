import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/migrate.test.ts'],
    pool: 'forks',
    fileParallelism: false,
  },
});
