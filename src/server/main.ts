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
import { proxyTrust } from './proxy';
const production = process.env.NODE_ENV === 'production';
const fixtureMode = process.env.MEETUP_SOURCE === 'fixture';
if (process.env.MEETUP_SOURCE && !['fixture', 'database'].includes(process.env.MEETUP_SOURCE))
  throw new Error('MEETUP_SOURCE must be database or fixture.');
const vite = production
  ? null
  : await (
      await import('vite')
    ).createServer({
      server: { middlewareMode: true, hmr: { port: Number(process.env.PORT ?? 3000) + 10000 } },
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
const pool = process.env.DATABASE_URL ? createPool(process.env.DATABASE_URL) : undefined;
const auth =
  pool && process.env.AUTH_SECRET
    ? createAuth({
        pool,
        origin: process.env.AUTH_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`,
        secret: process.env.AUTH_SECRET,
        sendMail: authMailer(process.env),
        providers: socialProviders(process.env),
      })
    : undefined;
const app = createApp({
  trustProxy: proxyTrust(process.env.TRUST_PROXY),
  attendance: pool && !fixtureMode ? databaseAttendance(pool) : undefined,
  community: pool && !fixtureMode ? databaseCommunity(pool) : undefined,
  observe: (event) => console.log(JSON.stringify({ event: 'http', ...event })),
  auth,
  meetings: fixtureMode ? undefined : databaseMeetings(pool),
  places: databasePlaces(pool, kmaWeather({ key: process.env.KMA_API_KEY })),
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
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
console.log(`C'mon Yo! ${production ? 'production' : 'development'} server listening`);
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, async () => {
    await app.close();
    await vite?.close();
    await pool?.end();
    process.exit(0);
  });
