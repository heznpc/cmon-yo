import { beforeAll, afterAll, describe, test, expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import snapshot from '../contracts/samples/muan-parks.json' with { type: 'json' };
import fixture from '../contracts/fixtures/place.json' with { type: 'json' };
import { collectParks, normalizeSnapshot } from '../src/server/facilities/source';
import { importParks } from '../src/server/facilities/import';
import { migrate } from '../src/server/db';
import { databasePlaces } from '../src/server/services/place';
import { createApp } from '../src/server/app';
import { renderPage } from '../src/server/render';
import { placeDetailSchema } from '../src/contracts/place';
import { kmaWeather } from '../src/server/weather/kma';
import { responseContract } from './helpers/openapi';

test('actual park sample preserves distinct same-name parks and unspecified facilities', () => {
  const places = normalizeSnapshot(snapshot);
  expect(places).toHaveLength(21);
  expect(places.filter((p) => p.name === '남악어린이공원8')).toHaveLength(2);
  expect(places.filter((p) => !p.exerciseFacilities.length)).toHaveLength(10);
  expect(places.find((p) => p.id === fixture.place.id)).toEqual(fixture.place);
  const malformed = structuredClone(snapshot);
  malformed.records[0].LATITUDE = '';
  expect(() => normalizeSnapshot(malformed)).toThrow();
  expect(() => normalizeSnapshot({ ...snapshot, records: snapshot.records.slice(1) })).toThrow();
  expect(() =>
    normalizeSnapshot({ ...snapshot, records: snapshot.records.map(() => snapshot.records[0]) }),
  ).toThrow();
});
test('public download rejects a partial page before producing a snapshot', async () => {
  let calls = 0;
  await expect(
    collectParks(async () => {
      calls++;
      return Response.json(
        calls === 1
          ? { totalCount: 2, tableVO: { colNmList: ['MANAGE_NO'], svcTableNm: 'observed' } }
          : [snapshot.records[0]],
      );
    }),
  ).rejects.toThrow();
  expect(calls).toBe(2);
});
test('TS place/weather contract rejects contradictory availability and malformed values', () => {
  expect(placeDetailSchema.parse(fixture)).toEqual(fixture);
  const bad = structuredClone(fixture);
  bad.weather.status = 'unavailable';
  expect(placeDetailSchema.safeParse(bad).success).toBe(false);
  expect(
    placeDetailSchema.safeParse({ ...fixture, weather: { status: 'fresh', facts: null } }).success,
  ).toBe(false);
  expect(
    placeDetailSchema.safeParse({ ...fixture, place: { ...fixture.place, latitude: 100 } }).success,
  ).toBe(false);
  expect(
    placeDetailSchema.safeParse({ ...fixture, weather: { status: 'unavailable', facts: null } })
      .success,
  ).toBe(true);
});

describe.runIf(process.env.TEST_DATABASE_URL)(
  'real PostgreSQL regional importer and service',
  () => {
    let pool: pg.Pool;
    let admin: pg.Pool;
    const schema = 'pr2_' + randomUUID().replaceAll('-', '');
    beforeAll(async () => {
      admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        options: `-c search_path=${schema}`,
      });
      await migrate(pool);
    });
    afterAll(async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
    test('dry-run writes no places; reruns and concurrent imports are idempotent; one-row edit updates only it', async () => {
      expect(await importParks(pool, snapshot, true)).toMatchObject({
        status: 'succeeded',
        inserted: 21,
      });
      expect((await pool.query('SELECT * FROM places')).rowCount).toBe(0);
      expect(await importParks(pool, snapshot, false)).toMatchObject({ inserted: 21 });
      for (const report of await Promise.all([
        importParks(pool, snapshot, false),
        importParks(pool, snapshot, false),
      ]))
        expect(report).toMatchObject({ inserted: 0, updated: 0, unchanged: 21 });
      const changed = structuredClone(snapshot);
      changed.records[0].PARK_NM += ' 변경 시험';
      expect(await importParks(pool, changed, false)).toMatchObject({
        inserted: 0,
        updated: 1,
        unchanged: 20,
      });
      await importParks(pool, snapshot, false);
    });
    test('invalid/partial source and mid-transaction DB failure preserve all existing rows', async () => {
      const before = (await pool.query('SELECT document FROM places ORDER BY source_key')).rows;
      const invalid = structuredClone(snapshot);
      invalid.records[1].LATITUDE = '91';
      expect(await importParks(pool, invalid, false)).toMatchObject({
        status: 'failed',
        received: 21,
        failedRows: [2],
      });
      expect(
        await importParks(pool, { ...snapshot, records: snapshot.records.slice(1) }, false),
      ).toMatchObject({ status: 'failed' });
      // Fail after another row has already been updated in the same transaction.
      await pool.query(
        `ALTER TABLE places ADD CONSTRAINT test_reject CHECK (document->>'name' <> 'reject-test')`,
      );
      const changed = structuredClone(snapshot);
      changed.records[0].PARK_NM = 'must-rollback';
      changed.records[1].PARK_NM = 'reject-test';
      expect(await importParks(pool, changed, false)).toMatchObject({
        status: 'failed',
        inserted: 0,
        updated: 0,
      });
      expect((await pool.query('SELECT document FROM places ORDER BY source_key')).rows).toEqual(
        before,
      );
      expect(
        (await pool.query("SELECT * FROM facility_import_runs WHERE report->>'status' = 'failed'"))
          .rowCount,
      ).toBe(3);
    });
    test('existing DB migration preserves rows and a second region is reachable through every page', async () => {
      const before = (await pool.query('SELECT document FROM places ORDER BY source_key')).rows;
      await pool.query('ALTER TABLE places DROP CONSTRAINT places_source_key_check');
      await pool.query(
        "ALTER TABLE places ADD CONSTRAINT places_source_key_check CHECK(source_key ~ '^46840-[0-9]{5}$')",
      );
      await migrate(pool);
      expect((await pool.query('SELECT document FROM places ORDER BY source_key')).rows).toEqual(
        before,
      );
      const second = {
        ...snapshot,
        regionCode: '11680',
        expectedCount: 101,
        records: Array.from({ length: 101 }, (_, i) => ({
          ...snapshot.records[0],
          MANAGE_NO: '11680-' + String(i + 1).padStart(5, '0'),
          PARK_NM: '[시험] 다른 지역 ' + (i + 1),
          INSTT_NM: '서울특별시 강남구',
        })),
      };
      expect(await importParks(pool, second, false)).toMatchObject({
        status: 'succeeded',
        inserted: 101,
      });
      const app = createApp({
        places: databasePlaces(pool, kmaWeather()),
        renderer: async () => renderPage,
      });
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      try {
        const check = responseContract(await (await fetch(origin + '/api/v1/openapi.json')).json());
        const catalog = await (await fetch(origin + '/api/v1/regions')).json();
        expect(check('/api/v1/regions', 200, catalog).valid).toBe(true);
        expect(catalog.regions).toContainEqual({ code: '11680', name: '서울특별시 강남구' });
        const first = await (await fetch(origin + '/api/v1/places?regionCode=11680')).json();
        expect(first.places).toHaveLength(100);
        expect(first.nextPage).toBe(1);
        const last = await (await fetch(origin + '/api/v1/places?regionCode=11680&page=1')).json();
        expect(last.places).toHaveLength(1);
        expect(last.nextPage).toBeNull();
        expect(new Set([...first.places, ...last.places].map((p) => p.id)).size).toBe(101);
        const nearby = await (
          await fetch(origin + '/api/v1/places?latitude=34.9&longitude=126.4')
        ).json();
        const nearbyLast = await (
          await fetch(origin + '/api/v1/places?latitude=34.9&longitude=126.4&page=1')
        ).json();
        expect(new Set([...nearby.places, ...nearbyLast.places].map((p) => p.id)).size).toBe(122);
        expect(
          await (await fetch(origin + '/api/v1/places?latitude=34.9&longitude=126.4')).json(),
        ).toEqual(nearby);
        expect((await fetch(origin + '/api/v1/places?regionCode=bad')).status).toBe(400);
        const html = await (await fetch(origin + '/places?regionCode=11680&page=1')).text();
        expect(html).toContain('[시험] 다른 지역 1');
        expect(html).not.toContain('근린공원 36');
        const detail = await (await fetch(origin + '/places/park-11680-00001')).text();
        expect(detail).toContain('[시험] 다른 지역 1');
        expect((await fetch(origin + '/api/v1/places/park-11680-00001/info')).status).toBe(200);
      } finally {
        app.server.closeAllConnections();
        await app.close();
      }
      await pool.query("DELETE FROM places WHERE source_key LIKE '11680-%'");
    });
    test('actual HTTP API and SSR read DB changes, empty, 404 and DB outage without fixture fallback', async () => {
      const service = databasePlaces(pool, kmaWeather());
      const app = createApp({ places: service, renderer: async () => renderPage });
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      try {
        const validate = responseContract(
          await (await fetch(`${origin}/api/v1/openapi.json`)).json(),
        );
        const detail = await (await fetch(`${origin}/api/v1/places/${fixture.place.id}`)).json();
        expect(validate('/api/v1/places/{id}', 200, detail)).toMatchObject({ valid: true });
        const list = await (await fetch(`${origin}/api/v1/places`)).json();
        expect(validate('/api/v1/places', 200, list)).toMatchObject({ valid: true });
        expect(detail).toEqual({
          place: fixture.place,
          weather: { status: 'unavailable', facts: null },
        });
        const html = await (await fetch(`${origin}/places/${fixture.place.id}`)).text();
        expect(html).toContain('근린공원 36');
        expect(html).toContain('날씨를 불러오지 못했습니다.');
        expect((await fetch(`${origin}/api/v1/places/park-46840-99999`)).status).toBe(404);
        expect((await fetch(`${origin}/api/v1/places/bad`)).status).toBe(400);
        await pool.query('DELETE FROM places'); // This test owns its isolated schema.
        expect(await (await fetch(`${origin}/api/v1/places`)).json()).toEqual({
          places: [],
          nextPage: null,
        });
        expect(await (await fetch(`${origin}/places`)).text()).toContain(
          '등록된 시설 정보가 없습니다.',
        );
        await pool.query('ALTER TABLE places RENAME TO test_places_offline');
        expect((await fetch(`${origin}/api/v1/places`)).status).toBe(503);
        expect((await fetch(`${origin}/places`)).status).toBe(503);
        await pool.query('ALTER TABLE test_places_offline RENAME TO places');
        await importParks(pool, snapshot, false);
        expect((await fetch(`${origin}/api/v1/places`)).status).toBe(200);
      } finally {
        app.server.closeAllConnections();
        await app.close();
      }
    });
  },
);
