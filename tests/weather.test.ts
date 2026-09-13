import { expect, test } from 'vitest';
import Fastify from 'fastify';
import {
  forecastGrid,
  forecastTimes,
  kmaWeather,
  normalizeForecast,
} from '../src/server/weather/kma';
import { forecastResponse } from './fixtures/kma';

test('KMA grid and publication delay distinguish issue date from target date', () => {
  // Official guide's printed vector and its C sample executed against the park coordinates.
  expect(forecastGrid(37.488201, 126.92981)).toEqual({ nx: 59, ny: 125 });
  expect(forecastGrid(34.80642405, 126.4842218)).toEqual({ nx: 52, ny: 67 });
  expect(forecastTimes(Date.parse('2026-09-12T17:09:00Z'))).toEqual({
    baseDate: '20260912',
    baseTime: '2300',
    issuedAt: '2026-09-12T14:00:00.000Z',
    validAt: '2026-09-12T18:00:00.000Z',
  });
  expect(forecastTimes(Date.parse('2026-09-12T17:10:00Z')).baseTime).toBe('0200');
  expect(() => forecastGrid(0, 0)).toThrow();
});
test('unknown, missing and provider sentinel values do not become clear weather or zero', () => {
  const request = { ...forecastTimes(Date.parse('2026-09-13T04:20:00Z')), nx: 51, ny: 67 };
  const row = {
    baseDate: '20260913',
    baseTime: '1100',
    fcstDate: '20260913',
    fcstTime: '1400',
    nx: 51,
    ny: 67,
  };
  const data = [
    { ...row, category: 'TMP', fcstValue: '21' },
    { ...row, category: 'PTY', fcstValue: '9' },
    { ...row, category: 'WSD', fcstValue: '-900' },
  ];
  expect(normalizeForecast(data, request, '2026-09-13T04:20:00.000Z')).toMatchObject({
    temperatureC: 21,
    precipitationProbabilityPercent: null,
    precipitationType: 'unknown',
    windSpeedMetersPerSecond: null,
  });
  expect(() => normalizeForecast([...data, data[0]], request, '')).toThrow('Duplicate');
  expect(() => normalizeForecast([{ ...data[0], nx: 60 }], request, '')).toThrow('Mismatched');
  expect(() => normalizeForecast([], request, '')).toThrow('No forecast');
  const march = { ...request, ...forecastTimes(Date.parse('2026-03-02T04:20:00Z')) };
  expect(() =>
    normalizeForecast(
      [{ ...data[0], baseDate: '20260302', fcstDate: '20260230' }],
      march,
      '2026-03-02T04:20:00.000Z',
    ),
  ).toThrow();
});
test('real HTTP adapter: fresh/cache, stale on upstream failure, deadline, cancellation and expiry', async () => {
  const upstream = Fastify();
  let requests = 0;
  let mode = 'normal';
  upstream.get('/', async (req, reply) => {
    requests++;
    if (mode === 'hang') {
      reply.hijack();
      return reply;
    }
    if (mode === 'error') return reply.code(503).send({});
    const response = forecastResponse(new URL(req.url, 'http://localhost'));
    if (mode === 'partial') response.response.body.totalCount++;
    if (mode === 'auth') response.response.header.resultCode = '30';
    return response;
  });
  const origin = await upstream.listen({ host: '127.0.0.1', port: 0 });
  let clock = Date.parse('2026-09-13T04:20:00Z');
  const options = {
    key: 'test-only',
    now: () => clock,
    ttlMs: 1000,
    fetcher: ((input, init) =>
      fetch(origin + '/' + new URL(String(input)).search, init)) as typeof fetch,
  };
  // Successful loopback requests use the product deadline, not an accidental
  // 80ms machine-performance requirement. The hanging case below still proves
  // the short deadline is enforced.
  const service = kmaWeather(options);
  const signal = new AbortController().signal;
  try {
    const fresh = await service(34.80642405, 126.4842218, signal);
    expect(fresh.status).toBe('fresh');
    expect(fresh.facts?.validAt).toBe('2026-09-13T05:00:00.000Z');
    expect((await service(34.80642405, 126.4842218, signal)).status).toBe('fresh');
    expect(requests).toBe(1);
    clock += 2000;
    mode = 'error';
    expect(await service(34.80642405, 126.4842218, signal)).toEqual({
      status: 'stale',
      facts: fresh.facts,
    });
    mode = 'normal';
    expect((await service(34.80642405, 126.4842218, signal)).status).toBe('fresh');
    clock += 2000;
    mode = 'partial';
    expect((await service(34.80642405, 126.4842218, signal)).status).toBe('stale');
    mode = 'auth';
    expect((await service(37.5667, 126.9784, signal)).status).toBe('unavailable');
    mode = 'hang';
    const start = Date.now();
    expect(
      (await kmaWeather({ ...options, deadlineMs: 80 })(37.5667, 126.9784, signal)).status,
    ).toBe('unavailable');
    expect(Date.now() - start).toBeLessThan(1000);
    const controller = new AbortController();
    const pending = service(37.5667, 126.9784, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
    clock += 3600_000;
    mode = 'error';
    expect((await service(34.80642405, 126.4842218, signal)).status).toBe('unavailable');
    expect(await kmaWeather()(34.8, 126.4, signal)).toEqual({ status: 'unavailable', facts: null });
  } finally {
    upstream.server.closeAllConnections();
    await upstream.close();
  }
});
