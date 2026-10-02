import { expect, test } from 'vitest';
import { runtimeConfig } from '../src/server/runtime-config';
import { createApp } from '../src/server/app';
import { renderPage } from '../src/server/render';
import { meetingInputSchema } from '../src/contracts/meetings';
import { communityCommandSchema } from '../src/contracts/community';
import type { Observation } from '../src/server/observability';
import { validAccountName } from '../src/server/auth/routes';
import type { AuthService } from '../src/server/auth/service';
import { databasePlaces } from '../src/server/services/place';
import { favoritePlacesKey } from '../src/contracts/place';
import { attendanceCommandSchema } from '../src/contracts/attendance';
import place from '../contracts/fixtures/place.json' with { type: 'json' };

// Regression specifications only: this change was reviewed without executing
// the application, compiler, tests or database, at the owner's request.
const production: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://test-only@127.0.0.1/cmon',
  AUTH_SECRET: 'test-only-secret-at-least-32-characters',
  AUTH_ORIGIN: 'https://cmon.example',
  AUTH_MAIL_TRANSPORT: 'smtp',
  EMAIL_SMTP_HOST: 'smtp.example',
  EMAIL_FROM: 'noreply@example.test',
};

test('production refuses a partially configured service before opening resources', () => {
  expect(runtimeConfig(production)).toMatchObject({ production: true, fixtureMode: false });
  for (const key of ['DATABASE_URL', 'AUTH_SECRET', 'AUTH_ORIGIN', 'AUTH_MAIL_TRANSPORT', 'EMAIL_SMTP_HOST', 'EMAIL_FROM'])
    expect(() => runtimeConfig({ ...production, [key]: '' })).toThrow();
  for (const origin of ['http://127.0.0.1:3000', 'https://cmon.example/', 'https://cmon.example/path'])
    expect(() => runtimeConfig({ ...production, AUTH_ORIGIN: origin })).toThrow();
  expect(() => runtimeConfig({ ...production, EMAIL_SMTP_USER: 'user' })).toThrow();
  expect(runtimeConfig({ NODE_ENV: 'production', MEETUP_SOURCE: 'fixture' })).toMatchObject({ host: '127.0.0.1' });
  expect(() => runtimeConfig({ MEETUP_SOURCE: 'fixture', HOST: '0.0.0.0' })).toThrow();
  expect(() => runtimeConfig({ ...production, HOST: '0.0.0.0' })).toThrow();
});

test('ports and proxy configuration are validated before startup', () => {
  for (const port of ['0', '-1', '65536', 'abc', '3000.5', ''])
    expect(() => runtimeConfig({ PORT: port })).toThrow();
  expect(() => runtimeConfig({ PORT: '60000' })).toThrow();
  expect(() => runtimeConfig({ TRUST_PROXY: 'true' })).toThrow();
  expect(runtimeConfig({ TRUST_PROXY: 'loopback' }).trustProxy).toEqual(['127.0.0.1', '::1']);
});

test('health endpoints distinguish liveness and readiness without leaking errors', async () => {
  let available = false;
  const app = createApp({
    renderer: async () => renderPage,
    ready: async () => { if (!available) throw new Error('private connection string'); },
  });
  try {
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    const failed = await app.inject('/health/ready');
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ status: 'unavailable' });
    expect(failed.body).not.toContain('private');
    available = true;
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
  } finally { await app.close(); }
});

test('unexpected errors are sanitized and handled failures remain observable', async () => {
  const events: Observation[] = [];
  const app = createApp({ renderer: async () => renderPage, telemetry: (event) => events.push(event) });
  app.get('/unexpected', async () => { throw new Error('private SQL or account data'); });
  app.get('/handled', async (_request, reply) => reply.code(503).send({ error: 'unavailable' }));
  try {
    const failed = await app.inject('/unexpected');
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR', retryable: true } });
    expect(failed.body).not.toContain('private');
    expect(failed.headers['x-frame-options']).toBe('DENY');
    expect(failed.headers['referrer-policy']).toBe('no-referrer');
    expect(failed.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    await app.inject('/handled');
    expect(events).toContainEqual(expect.objectContaining({ event: 'http_failure', route: '/handled', status: 503 }));
  } finally { await app.close(); }
});

test('user text rejects PostgreSQL NUL errors at the input boundary', () => {
  for (const name of ['', '  ', 'name\0', 'a'.repeat(61), null])
    expect(validAccountName(name)).toBe(false);
  expect(validAccountName('운동 사용자')).toBe(true);
  expect(attendanceCommandSchema.safeParse({ action: 'requestReview', reason: 'text\0' }).success).toBe(false);
  const meeting = {
    title: '모임', description: '안내', sport: 'walking', placeId: 'park-46840-00001',
    startsAt: '2026-10-04T00:00:00.000Z', endsAt: '2026-10-04T01:00:00.000Z', capacity: 5,
  };
  expect(meetingInputSchema.safeParse(meeting).success).toBe(true);
  for (const field of ['title', 'description'])
    expect(meetingInputSchema.safeParse({ ...meeting, [field]: 'text\0' }).success).toBe(false);
  const id = '11111111-1111-4111-8111-111111111111';
  for (const input of [
    { action: 'profile', name: 'text\0', regionCode: null, expectedVersion: 0 },
    { action: 'comment', parent: 'post', id, body: 'text\0' },
    { action: 'report', target: 'post', id, reason: 'text\0' },
    { action: 'create', input: { title: 'text\0', body: '글', sport: 'walking' } },
    { action: 'create', input: { title: '제목', body: 'text\0', sport: 'walking' } },
  ]) expect(communityCommandSchema.safeParse(input).success).toBe(false);
});

test('a stale account read cannot return the newly signed-in account', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const auth = {
    options: { baseURL: 'https://cmon.example' },
    api: { getSession: async () => ({ headers: new Headers(), response: { user: {
      id: userId, name: '사용자', email: 'user@example.test', emailVerified: true,
    } } }) },
  } as unknown as AuthService;
  const app = createApp({ auth, renderer: async () => renderPage });
  try {
    const stale = await app.inject({ url: '/api/v1/me', headers: { 'x-cmon-user': '22222222-2222-4222-8222-222222222222' } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'ACCOUNT_CHANGED' } });
    expect(stale.body).not.toContain('user@example.test');
    const current = await app.inject({ url: '/api/v1/me', headers: { 'x-cmon-user': userId } });
    expect(current.statusCode).toBe(200);
    expect(current.json().user.id).toBe(userId);
  } finally { await app.close(); }
});

test('browser and Native signup normalize names and reject invalid text before auth storage', async () => {
  const names: string[] = [];
  const auth = {
    options: { baseURL: 'https://cmon.example' },
    handler: async (request: Request) => {
      const body = await request.json() as { name: string };
      names.push(body.name);
      return Response.json({ success: true });
    },
  } as unknown as AuthService;
  const app = createApp({ auth, renderer: async () => renderPage });
  try {
    for (const [url, headers] of [
      ['/api/auth/sign-up/email', { origin: 'https://cmon.example' }],
      ['/api/native/auth/sign-up/email', {}],
    ] as const) {
      const rejected = await app.inject({ method: 'POST', url, headers, payload: { name: 'bad\0name' } });
      expect(rejected.statusCode).toBe(400);
      const accepted = await app.inject({ method: 'POST', url, headers, payload: { name: '  운동 사용자  ' } });
      expect(accepted.statusCode).toBe(200);
    }
    expect(names).toEqual(['운동 사용자', '운동 사용자']);
  } finally { await app.close(); }
});

test('facility SSR restores only its viewer favorites and tolerates private service outages', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  let identityFails = false, favoritesFail = false;
  const auth = {
    options: { baseURL: 'https://cmon.example' },
    api: { getSession: async () => {
      if (identityFails) throw new Error('private identity failure');
      return { headers: new Headers(), response: { user: {
        id: userId, name: '사용자', email: 'user@example.test', emailVerified: true,
      } } };
    } },
  } as unknown as AuthService;
  const app = createApp({
    auth,
    places: {
      ...databasePlaces(undefined, async () => ({ status: 'unavailable', facts: null })),
      list: async () => ({ places: [place.place] }),
      favorites: async (viewer) => {
        expect(viewer).toBe(userId);
        if (favoritesFail) throw new Error('private favorites failure');
        return { placeIds: [place.place.id] };
      },
    },
    // Inspect the server-render contract without coupling it to DOM structure.
    renderer: async () => async (reply, state) => { reply.send(state); },
  });
  try {
    const initial = await app.inject('/places');
    expect(initial.statusCode).toBe(200);
    expect(initial.json().route.userId).toBe(userId);
    expect(initial.json().dehydratedState.queries).toContainEqual(expect.objectContaining({
      queryKey: [...favoritePlacesKey(userId)],
      state: expect.objectContaining({ data: { placeIds: [place.place.id] } }),
    }));
    favoritesFail = true;
    const partial = await app.inject('/places');
    expect(partial.statusCode).toBe(200);
    expect(partial.json().route.userId).toBe(userId);
    expect(partial.json().dehydratedState.queries.some((query: { queryKey: unknown[] }) =>
      query.queryKey.includes('place-favorites'))).toBe(false);
    identityFails = true;
    const publicOnly = await app.inject('/places');
    expect(publicOnly.statusCode).toBe(200);
    expect(publicOnly.json().route).not.toHaveProperty('userId');
    expect(publicOnly.body).not.toContain(userId);
  } finally { await app.close(); }
});
