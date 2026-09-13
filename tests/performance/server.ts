// Loopback-only production measurement/QA harness. Never mounted by main.ts.
import Fastify from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import { productionAssets } from '../../src/server/assets';
import { createApp } from '../../src/server/app';
import { renderPage } from '../../src/server/render';
import { createPool, migrate } from '../../src/server/db';
import { createAuth } from '../../src/server/auth/service';
import { databasePlaces } from '../../src/server/services/place';
import { databaseMeetings, migrateMeetings } from '../../src/server/services/meetings';
import { importParks } from '../../src/server/facilities/import';
import { kmaWeather } from '../../src/server/weather/kma';
import { forecastResponse } from '../fixtures/kma';
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL required');
const port = Number(process.env.PERF_PORT ?? 3120),
  origin = `http://127.0.0.1:${port}`;
const schema = `perf_${randomUUID().replaceAll('-', '')}`;
const admin = createPool(process.env.TEST_DATABASE_URL);
await admin.query(`CREATE SCHEMA ${schema}`);
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('options', `-c search_path=${schema}`);
url.searchParams.set('application_name', schema);
const pool = createPool(url.href);
const auth = createAuth({
  pool,
  origin,
  secret: randomBytes(32).toString('hex'),
  sendMail: async () => {},
});
await (await getMigrations(auth.options)).runMigrations();
await migrate(pool);
await migrateMeetings(pool);
await importParks(
  pool,
  JSON.parse(await readFile('contracts/samples/muan-parks.json', 'utf8')),
  false,
);
const users: { email: string; password: string; name: string; id: string }[] = [];
for (const name of ['성능 주최 시험', '성능 참여 시험']) {
  const user = {
    email: `${randomUUID()}@example.test`,
    password: randomBytes(20).toString('hex'),
    name,
  };
  await auth.api.signUpEmail({ body: user });
  const result = await pool.query(
    'UPDATE auth_user SET "emailVerified"=true WHERE email=$1 RETURNING id',
    [user.email],
  );
  users.push({ ...user, id: result.rows[0].id as string });
}
const meetings = databaseMeetings(pool);
const ids: string[] = [];
for (let i = 0; i < 40; i++)
  ids.push(
    (
      await meetings.command(users[0]!.id, randomUUID(), {
        title: `[성능 시험] 운동 약속 ${String(i + 1).padStart(2, '0')}`,
        description: '로컬 성능 측정용 데이터',
        sport: 'walking',
        placeId: 'park-46840-00023',
        capacity: 100,
        startsAt: new Date(Date.now() + 86400000 + i * 60000).toISOString(),
        endsAt: new Date(Date.now() + 90000000 + i * 60000).toISOString(),
      })
    ).id,
  );
let mode = 'normal',
  delayMs = 700,
  ttlMs = 300000,
  weatherDeadlineMs = 2500,
  calls = 0,
  upstreamFailures = 0,
  upstreamClosed = 0;
let held: (() => void)[] = [];
let holdMembership = false;
let heldViewers: (() => void)[] = [];
let weatherEvents: Record<string, number> = {};
const upstream = Fastify();
upstream.get('/', async (r, p) => {
  calls++;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (mode === 'hold' || mode === 'timeout' || mode === 'delay')
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        p.raw.off('close', finish);
        resolve();
      };
      p.raw.once('close', finish);
      if (mode === 'delay') timer = setTimeout(finish, delayMs);
      else held.push(finish);
    });
  if (p.raw.destroyed) {
    upstreamClosed++;
    return;
  }
  if (mode === 'failure') {
    upstreamFailures++;
    return p.code(503).send({});
  }
  return forecastResponse(new URL(r.url, 'http://localhost'));
});
await upstream.listen({ host: '127.0.0.1', port: port + 1 });
const makeWeather = () =>
  kmaWeather({
    key: 'local-performance-only',
    ttlMs,
    deadlineMs: weatherDeadlineMs,
    observe: (e) => {
      weatherEvents[e] = (weatherEvents[e] ?? 0) + 1;
    },
    fetcher: (input, init) =>
      fetch(`http://127.0.0.1:${port + 1}/` + new URL(String(input)).search, init),
  });
let weather = makeWeather();
const places = databasePlaces(pool, (...args) => weather(...args));
const clientDir = resolve(process.env.PERF_ASSETS ?? 'dist/client');
const manifest = JSON.parse(await readFile(resolve(clientDir, '.vite/manifest.json'), 'utf8'));

let samples = 0,
  maxPoolWaiting = 0,
  dbWaitingSamples = 0,
  dbWaitersMax = 0,
  peakRss = process.memoryUsage().rss;
let cpu = process.cpuUsage(),
  start = performance.now();
let requests: { route: string; status: number; durationMs: number }[] = [];
let sampling = false;
const sampler = setInterval(async () => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  maxPoolWaiting = Math.max(maxPoolWaiting, pool.waitingCount);
  if (sampling) return;
  sampling = true;
  try {
    const r = await admin.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND wait_event_type IS NOT NULL",
      [schema],
    );
    samples++;
    const n = r.rows[0].n;
    if (n) dbWaitingSamples++;
    dbWaitersMax = Math.max(dbWaitersMax, n);
  } finally {
    sampling = false;
  }
}, 50);
const app = createApp({
  auth,
  places,
  meetings: {
    ...meetings,
    async membership(...args) {
      if (holdMembership) await new Promise<void>((resolve) => heldViewers.push(resolve));
      return meetings.membership(...args);
    },
  },
  renderer: async () => renderPage,
  assets: productionAssets(manifest),
  observe: (e) => {
    if (!e.route.startsWith('/_perf')) requests.push(e);
  },
});
app.get('/_perf/setup', async () => ({ users, ids, places: 21, meetings: 40 }));
app.get('/_perf/stats', async () => ({
  calls,
  weatherEvents,
  heldViewers: heldViewers.length,
  upstreamFailures,
  upstreamClosed,
  requests,
  samples,
  maxPoolWaiting,
  dbWaitingSamples,
  dbWaitersMax,
  peakRss,
  cpu: process.cpuUsage(cpu),
  elapsedMs: performance.now() - start,
}));
app.post('/_perf/control', async (r) => {
  const input = r.body as {
    mode?: string;
    holdMembership?: boolean;
    releaseViewers?: boolean;
    weatherDeadlineMs?: number;
    delayMs?: number;
    ttlMs?: number;
    reset?: boolean;
    release?: boolean;
    metrics?: boolean;
    resetAuth?: boolean;
  };
  if (input.mode) mode = input.mode;
  if (input.holdMembership !== undefined) holdMembership = input.holdMembership;
  if (input.weatherDeadlineMs !== undefined) weatherDeadlineMs = input.weatherDeadlineMs;
  if (input.releaseViewers) {
    const viewers = heldViewers;
    heldViewers = [];
    viewers.forEach((f) => f());
  }
  if (input.delayMs !== undefined) delayMs = input.delayMs;
  if (input.ttlMs !== undefined) ttlMs = input.ttlMs;
  if (input.reset) weather = makeWeather();
  if (input.resetAuth) await pool.query('DELETE FROM auth_rate_limit');
  if (input.release) {
    const pending = held;
    held = [];
    pending.forEach((f) => f());
  }
  if (input.metrics) {
    calls = 0;
    weatherEvents = {};
    upstreamFailures = 0;
    upstreamClosed = 0;
    requests = [];
    samples = 0;
    maxPoolWaiting = 0;
    dbWaitingSamples = 0;
    dbWaitersMax = 0;
    peakRss = process.memoryUsage().rss;
    cpu = process.cpuUsage();
    start = performance.now();
  }
  return { mode, delayMs, ttlMs };
});
await app.register((await import('@fastify/static')).default, {
  root: clientDir,
  prefix: '/',
  index: false,
});
await app.listen({ host: '127.0.0.1', port });
console.log(`Production measurement server ready on ${port}; 21 facilities, 40 synthetic meetings`);
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, async () => {
    clearInterval(sampler);
    held.forEach((f) => f());
    heldViewers.forEach((f) => f());
    app.server.closeAllConnections();
    upstream.server.closeAllConnections();
    await app.close();
    await upstream.close();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    process.exit(0);
  });
