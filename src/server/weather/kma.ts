import { z } from 'zod';
import type { Weather, WeatherFacts } from '../../contracts/place';

// KMA's 2026-06-23 API guide, Lambert projection sample (1-based grid).
export function forecastGrid(latitude: number, longitude: number) {
  const rad = Math.PI / 180;
  const re = 6371.00877 / 5;
  const slat1 = 30 * rad,
    slat2 = 60 * rad;
  const sn =
    Math.log(Math.cos(slat1) / Math.cos(slat2)) /
    Math.log(Math.tan(Math.PI / 4 + slat2 / 2) / Math.tan(Math.PI / 4 + slat1 / 2));
  const sf = (Math.pow(Math.tan(Math.PI / 4 + slat1 / 2), sn) * Math.cos(slat1)) / sn;
  const ro = (re * sf) / Math.pow(Math.tan(Math.PI / 4 + (38 * rad) / 2), sn);
  const ra = (re * sf) / Math.pow(Math.tan(Math.PI / 4 + (latitude * rad) / 2), sn);
  const theta = (longitude - 126) * rad * sn;
  const nx = Math.floor(ra * Math.sin(theta) + 43.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + 136.5);
  if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < 1 || nx > 149 || ny < 1 || ny > 253)
    throw new Error('Outside forecast grid');
  return { nx, ny };
}
export function forecastTimes(now: number) {
  // Forecast issue is available from HH:10 at 02,05,08,11,14,17,20,23 KST.
  const available = new Date(now + 9 * 3600_000 - 10 * 60_000);
  const issueHour = Math.floor((available.getUTCHours() - 2) / 3) * 3 + 2;
  available.setUTCHours(issueHour, 0, 0, 0);
  const issuedAt = new Date(available.getTime() - 9 * 3600_000).toISOString();
  const validAt = new Date(Math.ceil(now / 3600_000) * 3600_000).toISOString();
  const baseDate = available.toISOString().slice(0, 10).replaceAll('-', '');
  const baseTime = String(available.getUTCHours()).padStart(2, '0') + '00';
  return { issuedAt, validAt, baseDate, baseTime };
}
const rowSchema = z.object({
  baseDate: z.string(),
  baseTime: z.string(),
  fcstDate: z.string(),
  fcstTime: z.string(),
  category: z.string(),
  fcstValue: z.string(),
  nx: z.number(),
  ny: z.number(),
});
const responseSchema = z.object({
  response: z.object({
    header: z.object({ resultCode: z.literal('00') }),
    body: z.object({
      pageNo: z.number().int().positive(),
      totalCount: z.number().int().min(1).max(3000),
      items: z.object({ item: z.array(rowSchema) }),
    }),
  }),
});
type ForecastRequest = ReturnType<typeof forecastTimes> & { nx: number; ny: number };
function instant(date: string, time: string) {
  if (!/^\d{8}$/.test(date) || !/^([01]\d|2[0-3])[0-5]\d$/.test(time))
    throw new Error('Invalid forecast time');
  const day = z.iso.date().parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`);
  const iso = `${day}T${time.slice(0, 2)}:${time.slice(2)}:00+09:00`;
  return new Date(iso).toISOString();
}
export function normalizeForecast(
  input: unknown[],
  request: ForecastRequest,
  fetchedAt: string,
): WeatherFacts {
  const values = new Map<string, string>();
  for (const raw of input) {
    const row = rowSchema.parse(raw);
    if (
      row.nx !== request.nx ||
      row.ny !== request.ny ||
      row.baseDate !== request.baseDate ||
      row.baseTime !== request.baseTime
    )
      throw new Error('Mismatched forecast');
    if (instant(row.fcstDate, row.fcstTime) !== request.validAt) continue;
    if (values.has(row.category)) throw new Error('Duplicate forecast');
    values.set(row.category, row.fcstValue);
  }
  const number = (code: string, min: number, max: number) => {
    const raw = values.get(code)?.trim();
    if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
    const n = Number(raw);
    return n >= min && n <= max ? n : null;
  };
  const precipitationTypes: Record<string, WeatherFacts['precipitationType']> = {
    '0': 'none',
    '1': 'rain',
    '2': 'mixed',
    '3': 'snow',
    '4': 'rain',
  };
  const precipitationType = precipitationTypes[values.get('PTY') ?? ''] ?? 'unknown';
  const facts: WeatherFacts = {
    temperatureC: number('TMP', -90, 60),
    precipitationProbabilityPercent: number('POP', 0, 100),
    precipitationType,
    windSpeedMetersPerSecond: number('WSD', 0, 150),
    issuedAt: request.issuedAt,
    validAt: request.validAt,
    fetchedAt,
  };
  if (
    facts.temperatureC === null &&
    facts.precipitationProbabilityPercent === null &&
    facts.windSpeedMetersPerSecond === null &&
    precipitationType === 'unknown'
  )
    throw new Error('No forecast values');
  return facts;
}
export type WeatherService = (
  latitude: number,
  longitude: number,
  signal: AbortSignal,
) => Promise<Weather>;
export function kmaWeather({
  key,
  fetcher = fetch,
  now = Date.now,
  deadlineMs = 2500,
  ttlMs = 300_000,
  retryMs = 2000,
  maxEntries = 64,
  observe = () => {},
}: {
  key?: string;
  fetcher?: typeof fetch;
  now?: () => number;
  deadlineMs?: number;
  ttlMs?: number;
  retryMs?: number;
  maxEntries?: number;
  observe?: (
    event:
      | 'hit'
      | 'miss'
      | 'joined'
      | 'backoff'
      | 'success'
      | 'failure'
      | 'timeout'
      | 'cancelled'
      | 'evicted',
  ) => void;
} = {}): WeatherService {
  type Entry = { facts?: WeatherFacts; retryAt: number };
  type Flight = { controller: AbortController; promise: Promise<Weather>; consumers: number };
  const cache = new Map<string, Entry>();
  const flights = new Map<string, Flight>();
  const unavailable = (): Weather => ({ status: 'unavailable', facts: null });
  const valid = (facts?: WeatherFacts) =>
    facts && now() - Date.parse(facts.fetchedAt) <= 3600_000 && Date.parse(facts.validAt) >= now();
  const previous = (entry?: Entry): Weather =>
    valid(entry?.facts) ? { status: 'stale', facts: entry!.facts! } : unavailable();
  const save = (id: string, entry: Entry) => {
    cache.delete(id);
    if (cache.size >= maxEntries) {
      cache.delete(cache.keys().next().value!);
      observe('evicted');
    }
    cache.set(id, entry);
  };
  return async (latitude, longitude, signal) => {
    signal.throwIfAborted();
    if (!key) return unavailable();
    let grid: ReturnType<typeof forecastGrid>;
    try {
      grid = forecastGrid(latitude, longitude);
    } catch {
      return unavailable();
    }
    const time = now(),
      request = { ...grid, ...forecastTimes(time) };
    const cacheKey = `${grid.nx}:${grid.ny}:${request.validAt}`;
    const flightKey = `${cacheKey}:${request.issuedAt}`;
    for (const [id, entry] of cache)
      if (!valid(entry.facts) && entry.retryAt <= time) cache.delete(id);
    const prior = cache.get(cacheKey);
    if (
      prior?.facts &&
      prior.facts.issuedAt === request.issuedAt &&
      time - Date.parse(prior.facts.fetchedAt) < ttlMs
    ) {
      save(cacheKey, prior);
      observe('hit');
      return { status: 'fresh', facts: prior.facts };
    }
    if (prior && prior.retryAt > time) {
      observe('backoff');
      return previous(prior);
    }
    let flight = flights.get(flightKey);
    if (flight) observe('joined');
    else {
      observe('miss');
      if (flights.size >= maxEntries) return previous(prior);
      const controller = new AbortController();
      flight = { controller, consumers: 0, promise: Promise.resolve(unavailable()) };
      const currentFlight = flight;
      const timer = setTimeout(() => controller.abort(new Error('weather deadline')), deadlineMs);
      flight.promise = (async (): Promise<Weather> => {
        try {
          const rows: unknown[] = [];
          let total = 0;
          for (let page = 1; page <= 3; page++) {
            const url = new URL(
              'https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst',
            );
            for (const [name, value] of Object.entries({
              authKey: key,
              dataType: 'JSON',
              pageNo: page,
              numOfRows: 1000,
              base_date: request.baseDate,
              base_time: request.baseTime,
              ...grid,
            }))
              url.searchParams.set(name, String(value));
            const response = await fetcher(url, { signal: controller.signal });
            if (!response.ok) throw new Error('Forecast unavailable');
            const body = responseSchema.parse(await response.json()).response.body;
            if (body.pageNo !== page || (page > 1 && body.totalCount !== total))
              throw new Error('Partial forecast');
            total = body.totalCount;
            if (body.items.item.length !== Math.min(1000, total - rows.length))
              throw new Error('Partial forecast');
            rows.push(...body.items.item);
            if (rows.length === total) break;
          }
          controller.signal.throwIfAborted();
          const facts = normalizeForecast(rows, request, new Date(now()).toISOString());
          save(cacheKey, { facts, retryAt: 0 });
          observe('success');
          return { status: 'fresh', facts };
        } catch {
          if (controller.signal.aborted && currentFlight.consumers === 0) {
            observe('cancelled');
            return previous(prior);
          }
          observe(controller.signal.aborted ? 'timeout' : 'failure');
          save(cacheKey, {
            facts: valid(prior?.facts) ? prior?.facts : undefined,
            retryAt: now() + retryMs,
          });
          return previous(prior);
        } finally {
          clearTimeout(timer);
          if (flights.get(flightKey) === currentFlight) flights.delete(flightKey);
        }
      })();
      flights.set(flightKey, flight);
    }
    const shared = flight;
    shared.consumers++;
    // The upstream belongs to the flight, not the first request's signal.
    return new Promise<Weather>((resolve, reject) => {
      let done = false;
      const finish = (value?: Weather, error?: unknown) => {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', abort);
        shared.consumers--;
        if (shared.consumers === 0 && flights.get(flightKey) === shared) {
          flights.delete(flightKey);
          shared.controller.abort();
        }
        if (error) reject(error);
        else resolve(value!);
      };
      const abort = () => finish(undefined, signal.reason ?? new Error('Cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      shared.promise.then(
        (value) => finish(value),
        (error) => finish(undefined, error),
      );
      if (signal.aborted) abort();
    });
  };
}
