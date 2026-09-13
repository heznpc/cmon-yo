import { afterEach, test, expect, vi } from 'vitest';
import { createApp } from '../src/server/app';
import { renderPage } from '../src/server/render';
import { createRequestClient, loadMeetup } from '../src/server/loaders/meetup';
import { fixtureService } from '../src/server/services/meetup';
import { meetupDetailSchema } from '../src/contracts/meetup';
import fixture from '../contracts/fixtures/meetup.json' with { type: 'json' };
const id = fixture.meetup.id;
const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(
    apps.splice(0).map((app) => {
      app.server.closeAllConnections();
      return app.close();
    }),
  );
});
const make = (options: Partial<Parameters<typeof createApp>[0]> = {}) => {
  const app = createApp({ renderer: async () => renderPage, ...options });
  apps.push(app);
  return app;
};
test('API and SSR call the same service directly; no-store, 400, 404', async () => {
  const service = vi.fn(fixtureService());
  const app = make({ service });
  const api = await app.inject(`/api/v1/meetups/${id}`);
  expect(api.json()).toEqual(fixture);
  expect(api.headers['cache-control']).toBe('private, no-store');
  const page = await app.inject(`/meetups/${id}`);
  expect(page.statusCode).toBe(200);
  expect(page.body).toContain(fixture.meetup.title);
  expect(service.mock.calls.map((call) => call[0])).toEqual([id, id]);
  expect((await app.inject('/api/v1/meetups/bad')).statusCode).toBe(400);
  expect((await app.inject('/meetups/33333333-3333-4333-8333-333333333333')).statusCode).toBe(404);
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function isolation(shared: boolean) {
  const a = createRequestClient(),
    b = shared ? a : createRequestClient();
  const entered = deferred(),
    release = deferred();
  const first = loadMeetup(
    'A',
    async () => {
      entered.resolve();
      await release.promise;
      return meetupDetailSchema.parse(fixture);
    },
    new AbortController().signal,
    a,
  );
  await entered.promise;
  const second = await loadMeetup(
    'B',
    async () => ({
      ...meetupDetailSchema.parse(fixture),
      meetup: { ...fixture.meetup, title: 'Request B' },
    }),
    new AbortController().signal,
    b,
  );
  release.resolve();
  const firstState = await first;
  a.clear();
  b.clear();
  return [firstState.queries.map((q) => q.queryKey), second.queries.map((q) => q.queryKey)];
}
test('overlapping loads isolate dehydrated state; shared-client mutant is detected', async () => {
  expect(await isolation(false)).toEqual([[['meetup', 'A']], [['meetup', 'B']]]);
  expect(await isolation(true)).not.toEqual([[['meetup', 'A']], [['meetup', 'B']]]);
});
test('two overlapping real HTTP SSR requests contain only their own state', async () => {
  const waiting = deferred(),
    release = deferred();
  const other = '33333333-3333-4333-8333-333333333333';
  const app = make({
    service: async (requested) => {
      if (requested === id) {
        waiting.resolve();
        await release.promise;
      }
      return {
        ...meetupDetailSchema.parse(fixture),
        meetup: { ...fixture.meetup, id: requested, title: requested === id ? 'Only A' : 'Only B' },
      };
    },
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const first = fetch(`${url}/meetups/${id}`).then((r) => r.text());
  await waiting.promise;
  const second = await (await fetch(`${url}/meetups/${other}`)).text();
  release.resolve();
  expect(await first).not.toContain('Only B');
  expect(second).not.toContain('Only A');
});
test('service failure, shell failure and deadline clean request clients', async () => {
  const cleanup = vi.fn();
  const broken = make({
    onCleanup: cleanup,
    service: async () => {
      throw new Error('SERVER_SECRET');
    },
  });
  const result = await broken.inject(`/meetups/${id}`);
  expect(result.statusCode).toBe(503);
  expect(result.body).not.toContain('SERVER_SECRET');
  function Broken(): never {
    throw new Error('render');
  }
  const shell = make({
    onCleanup: cleanup,
    renderer: async () => (reply, state, client, assets, signal) =>
      renderPage(reply, state, client, assets, signal, <Broken />),
  });
  expect((await shell.inject(`/meetups/${id}`)).statusCode).toBe(500);
  const hung = make({
    onCleanup: cleanup,
    deadlineMs: 30,
    service: async (_, signal) =>
      new Promise((_, reject) =>
        signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  });
  expect((await hung.inject(`/meetups/${id}`)).statusCode).toBe(504);
  expect(cleanup).toHaveBeenCalledTimes(3);
});
test('client disconnect aborts in-flight data and cleans exactly once', async () => {
  const entered = deferred(),
    cancelled = deferred();
  const cleanup = vi.fn();
  const app = make({
    onCleanup: cleanup,
    service: async (_, signal) =>
      new Promise((_, reject) => {
        entered.resolve();
        signal!.addEventListener('abort', () => {
          cancelled.resolve();
          reject(new Error('aborted'));
        });
      }),
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const request = fetch(`${url}/meetups/${id}`, { signal: controller.signal }).catch(() => null);
  await entered.promise;
  controller.abort();
  await cancelled.promise;
  await request;
  expect(cleanup).toHaveBeenCalledTimes(1);
});
test('disconnect after shell aborts a suspended render and cleans once', async () => {
  const { Suspense } = await import('react');
  const cleanup = vi.fn();
  const forever = new Promise(() => {});
  function Pending(): never {
    throw forever;
  }
  const app = make({
    onCleanup: cleanup,
    renderer: async () => (reply, state, client, assets, signal) =>
      renderPage(
        reply,
        state,
        client,
        assets,
        signal,
        <Suspense fallback={<p>Waiting</p>}>
          <Pending />
        </Suspense>,
      ),
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const controller = new AbortController();
  const response = await fetch(`${url}/meetups/${id}`, { signal: controller.signal });
  expect(new TextDecoder().decode((await response.body!.getReader().read()).value)).toContain(
    'Waiting',
  );
  controller.abort();
  await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
});
