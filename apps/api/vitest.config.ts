import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://postgres:postgres@localhost:5432/brightloop_test',
      JWT_SECRET: 'test-secret-that-is-definitely-long-enough-123',
      APP_URL: 'http://localhost:5173',
    },
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
