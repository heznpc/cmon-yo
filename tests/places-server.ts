// Local QA only. Real PostgreSQL + local synthetic KMA HTTP server, never product fallback.
import Fastify from 'fastify';
import middie from '@fastify/middie';
import { createServer } from 'vite';
import { createApp } from '../src/server/app';
import { createPool } from '../src/server/db';
import { databasePlaces } from '../src/server/services/place';
import { ServiceError } from '../src/server/services/meetup';
import { kmaWeather } from '../src/server/weather/kma';
import { forecastResponse } from './fixtures/kma';

if (!process.env.DATABASE_URL) throw new Error('QA database required');
const pool = createPool(process.env.DATABASE_URL);
let state = 'normal';
const upstream = Fastify();
upstream.get('/', async (request, reply) => {
  if (state === 'weather-error') return reply.code(503).send({});
  if (state === 'weather-timeout') {
    reply.hijack();
    return reply;
  }
  return forecastResponse(new URL(request.url, 'http://localhost'));
});
await upstream.listen({ host: '127.0.0.1', port: 3113 });
const makeWeather = () =>
  kmaWeather({
    key: 'local-qa-only',
    ttlMs: 0,
    retryMs: 0,
    deadlineMs: 500,
    fetcher: (input, init) => fetch('http://127.0.0.1:3113/' + new URL(String(input)).search, init),
  });
let weather = makeWeather();
const db = databasePlaces(pool, (...args) => weather(...args));
const vite = await createServer({
  server: { middlewareMode: true, hmr: { port: 13112 } },
  appType: 'custom',
});
const app = createApp({
  assets: {
    scripts: ['/src/app/entry-client.tsx'],
    css: ['/src/features/meetup/meetup.css.ts.vanilla.css?direct'],
  },
  renderer: async () => (await vite.ssrLoadModule('/src/server/render.tsx')).renderPage,
  places: {
    regions: db.regions,
    async info(id, signal) {
      if (state === 'error')
        throw new ServiceError(503, 'UNAVAILABLE', '시설을 불러오지 못했습니다.');
      if (state === 'not-found')
        throw new ServiceError(404, 'NOT_FOUND', '시설을 찾을 수 없습니다.');
      const info = await db.info(id, signal);
      if (state === 'changed') info.place.name = '[QA] HTTP로 갱신된 공원';
      return info;
    },
    weather: db.weather,
    async list(signal) {
      if (state === 'error')
        throw new ServiceError(503, 'UNAVAILABLE', '시설을 불러오지 못했습니다.');
      if (state === 'empty') return { places: [] };
      return db.list(signal);
    },
    async detail(id, signal) {
      if (state === 'error')
        throw new ServiceError(503, 'UNAVAILABLE', '시설을 불러오지 못했습니다.');
      if (state === 'not-found')
        throw new ServiceError(404, 'NOT_FOUND', '시설을 찾을 수 없습니다.');
      const detail = await db.detail(id, signal);
      if (state === 'changed') detail.place.name = '[QA] HTTP로 갱신된 공원';
      return detail;
    },
  },
});
app.addHook('onRequest', async (request, reply) => {
  if (state === 'disconnect' && request.url.startsWith('/api/v1/places')) {
    reply.hijack();
    reply.raw.destroy();
  }
});
app.put('/_test/state/:state', async (request) => {
  state = (request.params as { state: string }).state;
  if (state === 'reset') {
    state = 'normal';
    weather = makeWeather();
  }
  return { state, weather: 'synthetic local response; not live KMA' };
});
await app.register(middie);
app.use(vite.middlewares);
await app.listen({ host: '127.0.0.1', port: 3112 });
console.log('PR2 QA: PostgreSQL + synthetic KMA HTTP on 3112/3113');
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, async () => {
    app.server.closeAllConnections();
    upstream.server.closeAllConnections();
    await app.close();
    await upstream.close();
    await vite.close();
    await pool.end();
    process.exit(0);
  });
