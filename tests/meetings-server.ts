// Loopback-only QA entry point. Real account verification and isolated DB.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import { createPool, migrate } from '../src/server/db';
import { createAuth } from '../src/server/auth/service';
import { databaseMeetings, migrateMeetings } from '../src/server/services/meetings';
import { databasePlaces } from '../src/server/services/place';
import { importParks } from '../src/server/facilities/import';
import { createApp } from '../src/server/app';
import { currentAccount } from '../src/server/auth/routes';
import type { AuthMail } from '../src/server/auth/mail';
import type { Assets } from '../src/server/render';
if (!process.env.TEST_DATABASE_URL) throw new Error('Separate QA database required.');
const port = Number(process.env.QA_PORT ?? 3115),
  production = process.env.QA_PRODUCTION === '1';
const schema = 'meeting_ui_' + randomUUID().replaceAll('-', '');
const admin = createPool(process.env.TEST_DATABASE_URL);
await admin.query(`CREATE SCHEMA ${schema}`);
const db = new URL(process.env.TEST_DATABASE_URL);
db.searchParams.set('options', `-c search_path=${schema}`);
const pool = createPool(db.href);
const mail: AuthMail[] = [];
const auth = createAuth({
  pool,
  origin: `http://127.0.0.1:${port}`,
  secret: randomBytes(32).toString('hex'),
  sendMail: async (m) => {
    mail.push(m);
  },
});
await (await getMigrations(auth.options)).runMigrations();
await migrate(pool);
await migrateMeetings(pool);
await importParks(
  pool,
  JSON.parse(await readFile('contracts/samples/muan-parks.json', 'utf8')),
  false,
);
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
  const entry = manifest['src/app/entry-client.tsx'];
  assets.scripts = ['/' + entry.file];
  assets.css = entry.css.map((p: string) => '/' + p);
}
const builtRenderer = production
  ? resolve(
      'dist/server/assets',
      (await readdir('dist/server/assets')).find((name) => /^render-.*\.js$/.test(name))!,
    )
  : undefined;
const app = createApp({
  auth,
  meetings: databaseMeetings(pool),
  places: databasePlaces(pool, async () => ({ status: 'unavailable', facts: null })),
  assets,
  renderer: async () =>
    production
      ? (await import(builtRenderer!)).renderPage
      : (await vite!.ssrLoadModule('/src/server/render.tsx')).renderPage,
});
app.get('/_test/slow-me', async (r, p) => {
  const account = await currentAccount(auth, r, p);
  await new Promise((resolve) => setTimeout(resolve, 900));
  return account;
});
app.get('/_test/mail', async (r, p) => {
  const q = r.query as { email: string; purpose: string };
  const m = [...mail].reverse().find((m) => m.to === q.email && m.purpose === q.purpose);
  return m ? { url: m.url } : p.code(404).send({});
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
await app.listen({ host: '127.0.0.1', port });
console.log(`Meetings QA ${production ? 'built assets' : 'development'} server on ${port}`);
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, async () => {
    app.server.closeAllConnections();
    await app.close();
    await vite?.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    process.exit(0);
  });
