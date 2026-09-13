// Local-only QA entry point. Real PostgreSQL/auth; captured mail replaces SMTP.
// Never imported by the product server, never a production authentication bypass.
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import middie from '@fastify/middie';
import { getMigrations } from 'better-auth/db/migration';
import { createPool } from '../src/server/db';
import { createAuth } from '../src/server/auth/service';
import type { AuthMail } from '../src/server/auth/mail';
import { createApp } from '../src/server/app';

if (!process.env.TEST_DATABASE_URL) throw new Error('A separate QA test database is required.');
const schema = 'auth_ui_' + randomUUID().replaceAll('-', '');
const admin = createPool(process.env.TEST_DATABASE_URL);
await admin.query(`CREATE SCHEMA ${schema}`);
const database = new URL(process.env.TEST_DATABASE_URL);
database.searchParams.set('options', `-c search_path=${schema}`);
const pool = createPool(database.href);
const mail: AuthMail[] = [];
const auth = createAuth({
  pool,
  origin: 'http://127.0.0.1:3114',
  secret: randomBytes(32).toString('hex'),
  sendMail: async (message) => {
    mail.push(message);
  },
});
await (await getMigrations(auth.options)).runMigrations();
const vite = await createServer({
  server: { middlewareMode: true, hmr: { port: 13114 } },
  appType: 'custom',
});
const app = createApp({
  auth,
  assets: {
    scripts: ['/src/app/entry-client.tsx'],
    css: [
      '/src/features/meetup/meetup.css.ts.vanilla.css?direct',
      '/src/features/account/account.css.ts.vanilla.css?direct',
    ],
  },
  renderer: async () => (await vite.ssrLoadModule('/src/server/render.tsx')).renderPage,
});
app.get('/_test/mail', async (request, reply) => {
  const query = request.query as { email?: string; purpose?: string };
  const message = [...mail].reverse().find(
    (value) => value.to === query.email && value.purpose === query.purpose,
  );
  return message ? { url: message.url } : reply.code(404).send({ error: 'No test mail' });
});
await app.register(middie);
app.use(vite.middlewares);
await app.listen({ host: '127.0.0.1', port: 3114 });
console.log('Account QA: real isolated PostgreSQL schema and local captured mail on 3114');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    app.server.closeAllConnections();
    await app.close();
    await vite.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    process.exit(0);
  });
