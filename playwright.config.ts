import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/web',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { headless: true, viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'meetings-development',
      testMatch: 'meetings.spec.ts',
      use: { baseURL: 'http://127.0.0.1:3115' },
    },
    {
      name: 'meetings-production',
      testMatch: 'meetings.spec.ts',
      use: { baseURL: 'http://127.0.0.1:3116' },
    },
    {
      name: 'development',
      testIgnore: ['account.spec.ts', 'meetings.spec.ts'],
      use: { baseURL: 'http://127.0.0.1:3000' },
    },
    {
      name: 'production',
      testIgnore: ['account.spec.ts', 'meetings.spec.ts'],
      use: { baseURL: 'http://127.0.0.1:3002' },
    },
    {
      name: 'account-development',
      testMatch: 'account.spec.ts',
      use: { baseURL: 'http://127.0.0.1:3114' },
    },
  ],
  webServer: [
    {
      command: 'npx tsx tests/meetings-server.ts',
      url: 'http://127.0.0.1:3115/meetups',
      reuseExistingServer: true,
    },
    {
      command: 'QA_PRODUCTION=1 QA_PORT=3116 npx tsx tests/meetings-server.ts',
      url: 'http://127.0.0.1:3116/meetups',
      reuseExistingServer: true,
    },
    {
      command: 'npx tsx tests/account-server.ts',
      url: 'http://127.0.0.1:3114/account',
      reuseExistingServer: true,
    },
    {
      command: 'npx tsx tests/places-server.ts',
      url: 'http://127.0.0.1:3112/places',
      reuseExistingServer: true,
    },
    {
      command: 'MEETUP_SOURCE=fixture MEETUP_FIXTURE_PATH=contracts/fixtures/meetup.json npm run dev',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: true,
    },
    {
      command: 'PORT=3002 MEETUP_SOURCE=fixture MEETUP_FIXTURE_PATH=contracts/fixtures/meetup.json npm start',
      url: 'http://127.0.0.1:3002',
      reuseExistingServer: true,
    },
    {
      command: 'PORT=3003 MEETUP_SOURCE=fixture MEETUP_FIXTURE_PATH=contracts/fixtures/malicious.json npm run dev',
      url: 'http://127.0.0.1:3003',
      reuseExistingServer: true,
    },
    {
      command: 'PORT=3004 MEETUP_SOURCE=fixture MEETUP_FIXTURE_PATH=contracts/fixtures/malicious.json npm start',
      url: 'http://127.0.0.1:3004',
      reuseExistingServer: true,
    },
  ],
});
