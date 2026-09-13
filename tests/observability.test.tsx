import { kmaWeather } from '../src/server/weather/kma';
import { test, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server/app';
import { renderPage } from '../src/server/render';
import { observeWeather, type Observation } from '../src/server/observability';

test('server error observation uses the error HTTP status before Fastify applies it to reply', async () => {
  const events: Observation[] = [];
  const app = createApp({
    telemetry: (event) => events.push(event),
    renderer: async () => renderPage,
  });
  app.get('/unexpected-error', async () => {
    throw new Error('synthetic failure');
  });
  app.get('/unavailable-error', async () => {
    throw Object.assign(new Error('synthetic unavailable'), { statusCode: 503 });
  });
  for (const [url, status] of [
    ['/unexpected-error', 500],
    ['/unavailable-error', 503],
  ] as const) {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(status);
    expect(events).toContainEqual(
      expect.objectContaining({ event: 'server_error', route: url, status }),
    );
  }
  await app.close();
});

test('request ID connects SSR failures, browser reports and weather events without private payloads', async () => {
  const events: Observation[] = [];
  function Broken(): never {
    throw new Error('private text must not be logged');
  }
  const app = createApp({
    telemetry: (event) => events.push(event),
    renderer: async () => (reply, state, client, assets, signal) =>
      renderPage(reply, state, client, assets, signal, <Broken />),
  });
  const weather = kmaWeather({
    key: 'test-only',
    observe: observeWeather,
    fetcher: async () => {
      throw new Error('private provider details');
    },
  });
  app.get('/weather-observation', async () => weather(34.8, 126.4, new AbortController().signal));
  const requestId = randomUUID();
  const failure = await app.inject({
    url: '/meetups/11111111-1111-4111-8111-111111111111',
    headers: { 'X-Request-ID': requestId },
  });
  expect(failure.statusCode).toBe(500);
  expect(failure.headers['x-request-id']).toBe(requestId);
  expect(events).toContainEqual(
    expect.objectContaining({ event: 'ssr_render_error', requestId, phase: 'shell' }),
  );
  await app.inject({ url: '/weather-observation', headers: { 'X-Request-ID': requestId } });
  expect(events).toContainEqual(
    expect.objectContaining({ event: 'weather', outcome: 'failure', requestId }),
  );
  const report = { event: 'request_failed', requestId, pageRequestId: randomUUID(), status: 503 };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/telemetry',
        headers: { origin: 'http://localhost:80' },
        payload: report,
      })
    ).statusCode,
  ).toBe(204);
  expect(events).toContainEqual(
    expect.objectContaining({ event: 'client_report', client: report }),
  );
  expect(JSON.stringify(events)).not.toContain('private text');
  await app.close();
});

test('diagnostics reject cross-origin and arbitrary fields, bound intake and isolate sink errors', async () => {
  const app = createApp({
    telemetry: () => {
      throw new Error('sink unavailable');
    },
    renderer: async () => renderPage,
  });
  const report = { event: 'browser_error' };
  const send = (origin: string, payload: object) =>
    app.inject({ method: 'POST', url: '/api/v1/telemetry', headers: { origin }, payload });
  expect((await send('https://foreign.example', report)).statusCode).toBe(403);
  expect((await send('http://localhost:80', { ...report, body: 'private input' })).statusCode).toBe(
    400,
  );
  expect((await send('http://localhost:80', report)).statusCode).toBe(204);
  for (let i = 0; i < 300; i++) await send('http://localhost:80', report);
  expect((await send('http://localhost:80', report)).statusCode).toBe(429);
  const invalidId = await app.inject({
    url: '/api/v1/places',
    headers: { 'X-Request-ID': 'email@example.test' },
  });
  expect(invalidId.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  await app.close();
});
