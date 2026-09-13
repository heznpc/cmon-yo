import { readdir, readFile } from 'node:fs/promises';
const files = await readdir('dist/client/assets');
for (const file of files.filter((name) => name.endsWith('.js'))) {
  const text = await readFile(`dist/client/assets/${file}`, 'utf8');
  for (const forbidden of [
    'MEETUP_FIXTURE_PATH',
    'SERVER_SECRET',
    'fixtureService',
    'node:fs',
    'fastify',
    'contracts/fixtures/meetup.json',
    'DATABASE_URL',
    'KMA_API_KEY',
    'AUTH_SECRET',
    'EMAIL_SMTP_PASSWORD',
    'encryptOAuthTokens',
    'auth_verification',
    'authKey',
    'pg_advisory',
    'facility_import_runs',
    "C'mon Yo! HTTP API",
  ]) {
    if (text.includes(forbidden))
      throw new Error(`Server-only marker ${forbidden} in browser bundle`);
  }
}
console.log('Browser assets: server-only markers absent.');
