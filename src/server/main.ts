import { databaseWalking } from './walking/service';
import { observeWeather } from './observability';
import { databaseAttendance } from './services/attendance';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { productionAssets } from './assets';
import { createApp } from './app';
import { fixtureService } from './services/meetup';
import type { Assets } from './render';
import { createPool } from './db';
import { databasePlaces } from './services/place';
import { kmaWeather } from './weather/kma';
import { createAuth, socialProviders } from './auth/service';
import { authMailer } from './auth/mail';
import { databaseMeetings } from './services/meetings';
import { databaseCommunity } from './services/community';
import { runtimeConfig } from './runtime-config';
import { assertMigrationsCurrent } from './migrations';
const { production, fixtureMode, port, host, trustProxy } = runtimeConfig(process.env);
// These constructors validate configuration without sending mail or opening a
// database connection. Invalid SMTP/provider settings must fail before Vite/pg.
const configuredAuth = !fixtureMode && !!process.env.DATABASE_URL && !!process.env.AUTH_SECRET;
const sendMail = configuredAuth ? authMailer(process.env) : undefined;
const providers = configuredAuth ? socialProviders(process.env) : undefined;
const vite = production
  ? null
  : await (
      await import('vite')
    ).createServer({
      server: { middlewareMode: true, hmr: { port: port + 10000 } },
      appType: 'custom',
    });
const assets: Assets = {
  scripts: ['/src/app/entry-client.tsx'],
  css: [
    '/src/features/meetup/meetup.css.ts.vanilla.css?direct',
    '/src/features/account/account.css.ts.vanilla.css?direct',
  ],
};
if (production) {
  const manifest = JSON.parse(await readFile('dist/client/.vite/manifest.json', 'utf8'));
  Object.assign(assets, productionAssets(manifest));
}
const pool = !fixtureMode && process.env.DATABASE_URL ? createPool(process.env.DATABASE_URL) : undefined;
// An idle connection can fail outside a query promise. Consume pg's error event
// without logging connection strings, SQL, account or health data.
pool?.on('error', () => console.error(JSON.stringify({ event: 'database_connection_error' })));
if (production && pool) {
  try {
    await assertMigrationsCurrent(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
}
const auth =
  pool && process.env.AUTH_SECRET
    ? createAuth({
        pool,
        origin: process.env.AUTH_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`,
        secret: process.env.AUTH_SECRET,
        sendMail: sendMail!,
        providers,
      })
    : undefined;
const app = createApp({
  trustProxy,
  ready: async () => {
    if (fixtureMode) return;
    if (!pool) throw new Error('Database unavailable.');
    await pool.query('SELECT 1');
  },
  walking: pool && !fixtureMode ? databaseWalking(pool) : undefined,
  attendance: pool && !fixtureMode ? databaseAttendance(pool) : undefined,
  community: pool && !fixtureMode ? databaseCommunity(pool) : undefined,
  telemetry: (event) => console.log(JSON.stringify(event)),
  observe: (event) => console.log(JSON.stringify({ event: 'http', ...event })),
  auth,
  meetings: fixtureMode ? undefined : databaseMeetings(pool),
  places: databasePlaces(
    pool,
    kmaWeather({ key: process.env.KMA_API_KEY, observe: observeWeather }),
  ),
  service: fixtureService(process.env.MEETUP_FIXTURE_PATH),
  assets,
  renderer: async () =>
    production
      ? (await import('./render')).renderPage
      : (await vite!.ssrLoadModule('/src/server/render.tsx')).renderPage,
});
if (vite) {
  await app.register((await import('@fastify/middie')).default);
  app.use(vite.middlewares);
} else
  await app.register((await import('@fastify/static')).default, {
    root: resolve('dist/client'),
    prefix: '/',
    index: false,
  });
await app.listen({ host, port });
console.log(`C'mon Yo! ${production ? 'production' : 'development'} server listening`);
let stopping = false;
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      console.error(JSON.stringify({ event: 'shutdown_timeout' }));
      process.exit(1);
    }, 15_000);
    deadline.unref();
    try {
      await app.close();
      await vite?.close();
      await pool?.end();
      clearTimeout(deadline);
      process.exit(0);
    } catch {
      console.error(JSON.stringify({ event: 'shutdown_failed' }));
      process.exit(1);
    }
  });
