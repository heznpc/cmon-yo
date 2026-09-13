// Local-only integration harness. These routes are never imported by the product server.
import Fastify from 'fastify';
import middie from '@fastify/middie';
import { createServer } from 'vite';
import { createApp } from '../src/server/app';
import { fixtureService, ServiceError } from '../src/server/services/meetup';
const vite = await createServer({
  server: { middlewareMode: true, hmr: { port: 13100 } },
  appType: 'custom',
});
let state = 'normal';
const fixture = fixtureService();
const app = createApp({
  renderer: async () => (await vite.ssrLoadModule('/src/server/render.tsx')).renderPage,
  assets: { scripts: ['/src/app/entry-client.tsx'], css: [] },
  service: async (id, signal) => {
    if (state === 'not-found') throw new ServiceError(404, 'NOT_FOUND', '모임을 찾을 수 없습니다.');
    if (state === 'error') throw new ServiceError(503, 'UNAVAILABLE', '연결 실패');
    const value = await fixture(id, signal);
    if (state === 'changed') value.meetup.title = '[Fixture] HTTP에서 변경된 모임';
    return value;
  },
});
app.addHook('onRequest', async (request, reply) => {
  if (state === 'disconnect' && request.url.startsWith('/api/v1/meetups/')) {
    reply.hijack();
    reply.raw.destroy();
  }
});
app.put('/_test/state/:state', async (request) => {
  state = (request.params as { state: string }).state;
  return { state };
});
app.get('/_test/blank', async (_, reply) =>
  reply.type('text/html').send('<!doctype html><html><body>WebKit integration</body></html>'),
);
const message = JSON.stringify({
  version: 1,
  requestId: '44444444-4444-4444-8444-444444444444',
  type: 'openMeetup',
  payload: { meetupId: '11111111-1111-4111-8111-111111111111' },
});
app.get('/_test/frame', async (_, reply) =>
  reply
    .type('text/html')
    .send(
      `<script>window.webkit.messageHandlers.cmonYo.postMessage(${message}).then(() => parent.postMessage('unexpected','*')).catch(e => parent.postMessage(String(e),'*'))</script>`,
    ),
);
app.get('/_test/subframe', async (_, reply) =>
  reply
    .type('text/html')
    .send(
      `<script>window.frameResult=new Promise(resolve=>window.addEventListener('message',e=>resolve(e.data),{once:true}))</script><iframe src="/_test/frame"></iframe>`,
    ),
);
await app.register(middie);
app.use(vite.middlewares);
await app.listen({ host: '127.0.0.1', port: 3100 });
const other = Fastify();
other.get('/_test/blank', async (_, reply) =>
  reply.type('text/html').send('<!doctype html><p>Other origin</p>'),
);
await other.listen({ host: '127.0.0.1', port: 3101 });
console.log('iOS integration harness ready on 3100/3101');
