import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/web',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { headless: true, viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'development', use: { baseURL: 'http://127.0.0.1:3000' } },
    { name: 'production', use: { baseURL: 'http://127.0.0.1:3002' } },
  ],
  webServer: [
    {
      command: 'npx tsx tests/places-server.ts',
      url: 'http://127.0.0.1:3112/places',
      reuseExistingServer: true,
    },
    { command: 'npm run dev', url: 'http://127.0.0.1:3000', reuseExistingServer: true },
    { command: 'PORT=3002 npm start', url: 'http://127.0.0.1:3002', reuseExistingServer: true },
    {
      command: 'PORT=3003 MEETUP_FIXTURE_PATH=contracts/fixtures/malicious.json npm run dev',
      url: 'http://127.0.0.1:3003',
      reuseExistingServer: true,
    },
    {
      command: 'PORT=3004 MEETUP_FIXTURE_PATH=contracts/fixtures/malicious.json npm start',
      url: 'http://127.0.0.1:3004',
      reuseExistingServer: true,
    },
  ],
});
