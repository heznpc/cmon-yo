import { expect, test } from 'vitest';
import snapshot from '../contracts/samples/muan-parks.json' with { type: 'json' };
import fixture from '../contracts/fixtures/place.json' with { type: 'json' };
import {
  normalizeSnapshot,
  collectParks,
  facilityRegionCodes,
} from '../src/server/facilities/source';
import { placeDetailSchema, placeFiltersSchema } from '../src/contracts/place';
import { meetingFiltersSchema } from '../src/contracts/meetings';
import { profileSchema, postInputSchema } from '../src/contracts/community';

test('a second region is accepted by facility import and Web contracts', () => {
  const sample = {
    ...snapshot,
    regionCode: '11680',
    expectedCount: 1,
    records: [{ ...snapshot.records[0], MANAGE_NO: '11680-00001' }],
  };
  expect(normalizeSnapshot(sample)[0].id).toBe('park-11680-00001');
  expect(
    placeDetailSchema.safeParse({
      ...fixture,
      place: { ...fixture.place, id: 'park-11680-00001' },
    }).success,
  ).toBe(true);
});

test('nearby facility filters require a complete device coordinate pair', () => {
  expect(placeFiltersSchema.parse({ latitude: '37.5665', longitude: '126.978' })).toMatchObject({
    latitude: 37.5665,
    longitude: 126.978,
  });
  expect(placeFiltersSchema.safeParse({ latitude: 37.5665 }).success).toBe(false);
});

test('meeting, post and profile contracts do not select a region on behalf of the user', () => {
  expect(meetingFiltersSchema.parse({}).regionCode).toBeUndefined();
  expect(meetingFiltersSchema.parse({ regionCode: '11680' }).regionCode).toBe('11680');
  expect(
    postInputSchema.safeParse({
      title: '질문',
      body: '본문',
      sport: 'walking',
      regionCode: '11680',
    }).success,
  ).toBe(true);
  expect(
    profileSchema.safeParse({
      userId: '11111111-1111-4111-8111-111111111111',
      name: '시험',
      regionCode: '11680',
      version: 1,
    }).success,
  ).toBe(true);
});

test('capture scope is explicit configuration and empty configuration keeps every region', async () => {
  const rows = [snapshot.records[0], { ...snapshot.records[1], MANAGE_NO: '11680-00002' }];
  const fetcher = async (input: string | URL | Request) =>
    Response.json(
      String(input).includes('columList')
        ? { totalCount: 2, tableVO: { colNmList: ['MANAGE_NO'], svcTableNm: 'test' } }
        : rows,
    );
  expect(facilityRegionCodes(' 11110,11680,11110 ')).toEqual(['11110', '11680']);
  expect(() => facilityRegionCodes('11680,broken')).toThrow();
  const all = await collectParks(fetcher, facilityRegionCodes(''));
  expect(all.regionCode).toBeNull();
  expect(normalizeSnapshot(all)).toHaveLength(2);
  const selected = await collectParks(fetcher, facilityRegionCodes('11680'));
  expect(selected.collection.received).toBe(2);
  expect(selected.records.map((row) => row.MANAGE_NO)).toEqual(['11680-00002']);
  expect(normalizeSnapshot(selected)[0].id).toBe('park-11680-00002');
  expect(() => normalizeSnapshot({ ...selected, records: [rows[0]] })).toThrow();
});
