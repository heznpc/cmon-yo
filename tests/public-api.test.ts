import { test, expect } from 'vitest';
import Fastify from 'fastify';
import meetup from '../contracts/fixtures/meetup.json' with { type: 'json' };
import place from '../contracts/fixtures/place.json' with { type: 'json' };
import { createApp } from '../src/server/app';
import { fixtureService, ServiceError } from '../src/server/services/meetup';
import { createPublicAPI, PublicApiError } from '../src/api/public';
import { responseContract } from './helpers/openapi';
import { Ajv2020 } from 'ajv/dist/2020';

test('published OpenAPI matches actual HTTP reads, empty results and 400/404/503 envelopes', async () => {
  let unavailable = false;
  let empty = false;
  const fixture = fixtureService();
  const app = createApp({
    renderer: async () => {
      throw new Error('API must not render HTML');
    },
    service: (id, signal) => {
      if (unavailable) throw new ServiceError(503, 'UNAVAILABLE', 'internal detail');
      return fixture(id, signal);
    },
    places: {
      list: async () => {
        if (unavailable) throw new Error('internal storage failure');
        return { places: empty ? [] : [place.place] };
      },
      detail: async (id) => {
        if (unavailable) throw new Error('internal storage failure');
        if (id !== place.place.id) throw new ServiceError(404, 'NOT_FOUND', 'missing');
        return { place: place.place, weather: { status: 'unavailable', facts: null } };
      },
    },
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const spec = await (await fetch(`${origin}/api/v1/openapi.json`)).json();
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/api/v1/me',
      '/api/v1/meetups/{id}',
      '/api/v1/places',
      '/api/v1/places/{id}',
    ]);
    const validate = responseContract(spec);
    const uuid = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const parameter = spec.paths['/api/v1/meetups/{id}'].get.parameters[0];
    expect(new Ajv2020().compile(parameter.schema)(uuid)).toBe(true);
    const check = async (path: string, template: string, status: number) => {
      const response = await fetch(origin + path);
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      const body = await response.json();
      expect(validate(template, status, body)).toMatchObject({ valid: true });
      return body;
    };
    await check(`/api/v1/meetups/${meetup.meetup.id}`, '/api/v1/meetups/{id}', 200);
    await check('/api/v1/places', '/api/v1/places', 200);
    const detail = await check(`/api/v1/places/${place.place.id}`, '/api/v1/places/{id}', 200);
    expect(
      validate('/api/v1/places/{id}', 200, {
        ...detail,
        weather: { status: 'fresh', facts: null },
      }).valid,
    ).toBe(false);
    expect(validate('/api/v1/places/{id}', 200, { ...detail, futureField: true }).valid).toBe(true);
    for (const resource of ['meetups', 'places'])
      await check(`/api/v1/${resource}/bad`, `/api/v1/${resource}/{id}`, 400);
    await check(
      '/api/v1/meetups/33333333-3333-4333-8333-333333333333',
      '/api/v1/meetups/{id}',
      404,
    );
    await check('/api/v1/places/park-46840-99999', '/api/v1/places/{id}', 404);
    await check(`/api/v1/meetups/${uuid}`, '/api/v1/meetups/{id}', 404);
    empty = true;
    expect(await check('/api/v1/places', '/api/v1/places', 200)).toEqual({ places: [] });
    unavailable = true;
    for (const [path, template] of [
      [`/api/v1/meetups/${meetup.meetup.id}`, '/api/v1/meetups/{id}'],
      ['/api/v1/places', '/api/v1/places'],
      [`/api/v1/places/${place.place.id}`, '/api/v1/places/{id}'],
    ]) {
      const body = await check(path, template, 503);
      expect(body.error).toMatchObject({ code: 'UNAVAILABLE', retryable: true });
      expect(JSON.stringify(body)).not.toContain('internal');
    }
  } finally {
    app.server.closeAllConnections();
    await app.close();
  }
});

test('web HTTP client validates wire data, retains error metadata, maps detail 404 and never auto-retries', async () => {
  const server = Fastify();
  let status = 200;
  let body: unknown = meetup;
  let calls = 0;
  server.get('/api/v1/*', async (_request, reply) => {
    calls++;
    return reply.code(status).type('application/json').send(body);
  });
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const api = createPublicAPI((path, init) => fetch(new URL(String(path), origin), init));
  const signal = new AbortController().signal;
  try {
    body = {
      ...meetup,
      meetup: { ...meetup.meetup, sport: 'future-sport', description: undefined },
      extra: true,
    };
    expect(await api.meetup(meetup.meetup.id, signal)).toMatchObject({
      meetup: { sport: 'unknown', description: null },
    });
    body = { ...place, weather: { status: 'unavailable', facts: null }, futureField: 'ignored' };
    const detail = await api.place(place.place.id, signal);
    expect(detail?.weather.status).toBe('unavailable');
    expect(detail).not.toHaveProperty('futureField');
    body = { places: [place.place] };
    expect(await api.places(signal)).toEqual(body);

    status = 404;
    body = '<html>gateway error</html>';
    expect(await api.place(place.place.id, signal)).toBeNull();
    expect(await api.meetup(meetup.meetup.id, signal)).toBeNull();
    await expect(api.places(signal)).rejects.toMatchObject({ status: 404, code: 'HTTP_ERROR' });

    status = 503;
    body = {
      error: {
        code: 'NEW_UPSTREAM_ERROR',
        message: 'INTERNAL_PROVIDER_DETAIL',
        requestId: 'request-test',
        retryable: true,
      },
    };
    const before = calls;
    const failure = await api.places(signal).catch((error) => error);
    expect(failure).toBeInstanceOf(PublicApiError);
    expect(failure).toMatchObject({
      status: 503,
      code: 'NEW_UPSTREAM_ERROR',
      requestId: 'request-test',
      retryable: true,
    });
    expect(failure.message).not.toContain('INTERNAL_PROVIDER_DETAIL');
    expect(calls - before).toBe(1);

    status = 200;
    for (const invalid of ['not-json', { ...place, weather: { status: 'fresh', facts: null } }]) {
      body = invalid;
      await expect(api.place(place.place.id, signal)).rejects.toMatchObject({
        status: 200,
        code: 'INVALID_RESPONSE',
        retryable: false,
      });
    }
    body = { ...place, weather: { status: 'unavailable', facts: null } };
    expect(await api.place(place.place.id, signal)).toEqual(body);
  } finally {
    server.server.closeAllConnections();
    await server.close();
  }
});

test('web HTTP client distinguishes a closed connection from cancellation, including an unfinished JSON body', async () => {
  const server = Fastify();
  let pending = false;
  let started!: () => void;
  const bodyStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let reading!: () => void;
  const bodyReading = new Promise<void>((resolve) => {
    reading = resolve;
  });
  server.get('/api/v1/places', async (_request, reply) => {
    reply.hijack();
    if (pending) {
      reply.raw.writeHead(200, { 'Content-Type': 'application/json' });
      reply.raw.write('{"places":');
      started();
    } else reply.raw.destroy();
  });
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  let calls = 0;
  const api = createPublicAPI(async (path, init) => {
    calls++;
    const response = await fetch(new URL(String(path), origin), init);
    // Observe the real body's consumption so cancellation cannot pass merely
    // because it happened before fetch received the response headers.
    const json = response.json.bind(response);
    response.json = () => {
      const result = json();
      reading();
      return result;
    };
    return response;
  });
  try {
    await expect(api.places(new AbortController().signal)).rejects.toMatchObject({
      status: null,
      code: 'NETWORK_ERROR',
      retryable: true,
    });
    pending = true;
    const controller = new AbortController();
    const request = api.places(controller.signal);
    await bodyStarted;
    await bodyReading;
    const reason = new Error('navigation cancelled');
    controller.abort(reason);
    await expect(request).rejects.toBe(reason);
    const before = calls;
    await expect(api.places(controller.signal)).rejects.toBe(reason);
    expect(calls).toBe(before);
  } finally {
    server.server.closeAllConnections();
    await server.close();
  }
});
