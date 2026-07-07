import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'test/auth.test.ts',
      'test/customer.test.ts',
      'test/reservations.test.ts',
      'test/companyAccess.test.ts',
    ],
    pool: 'forks',
    fileParallelism: false,
  },
});
