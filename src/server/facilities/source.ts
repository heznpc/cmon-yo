import { z } from 'zod';
import { placeSchema, type Place } from '../../contracts/place';

export const source = 'data.go.kr/15012890';
const coordinate = z.string().trim().min(1).transform(Number).pipe(z.number().finite());
const rowSchema = z.object({
  MANAGE_NO: z.string().regex(/^46840-\d{5}$/),
  PARK_NM: z.string().trim().min(1),
  PARK_SE: z.string().trim().min(1),
  RDNMADR: z.string(),
  LNMADR: z.string(),
  LATITUDE: coordinate,
  LONGITUDE: coordinate,
  MVM_FCLTY: z.string(),
  REFERENCE_DATE: z.iso.date(),
});
export const snapshotSchema = z
  .object({
    source: z.literal(source),
    regionCode: z.literal('46840'),
    capturedAt: z.iso.datetime(),
    collection: z
      .object({
        complete: z.literal(true),
        total: z.number().int().positive(),
        received: z.number().int().positive(),
        pages: z.number().int().positive(),
      })
      .refine((v) => v.total === v.received),
    expectedCount: z.number().int().positive(),
    records: z.array(z.unknown()),
  })
  .refine((v) => v.expectedCount === v.records.length);
export class SourceError extends Error {
  constructor(public readonly rows: number[]) {
    super('Invalid or incomplete facility source');
  }
}
export function normalizeSnapshot(input: unknown): Place[] {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) throw new SourceError([]);
  const places: Place[] = [];
  const failures: number[] = [];
  const seen = new Set<string>();
  parsed.data.records.forEach((value, index) => {
    const row = rowSchema.safeParse(value);
    if (!row.success || seen.has(row.data.MANAGE_NO)) {
      failures.push(index + 1);
      return;
    }
    seen.add(row.data.MANAGE_NO);
    const r = row.data;
    const place = placeSchema.safeParse({
      id: `park-${r.MANAGE_NO}`,
      name: r.PARK_NM,
      kind: r.PARK_SE,
      address: r.RDNMADR.trim() || r.LNMADR.trim(),
      latitude: r.LATITUDE,
      longitude: r.LONGITUDE,
      // Source describes facilities in a park, not individual equipment or quantities.
      exerciseFacilities: [
        ...new Set(
          r.MVM_FCLTY.split('+')
            .map((s) => s.trim())
            .filter(Boolean),
        ),
      ],
      sourceDate: r.REFERENCE_DATE,
    });
    if (!place.success) failures.push(index + 1);
    else places.push(place.data);
  });
  if (failures.length) throw new SourceError(failures);
  return places;
}

// The portal's public file-download protocol, observed on 2026-09-13.
// Fetch every page before publishing a regional snapshot. Absence never deletes DB rows.
export async function collectParks(fetcher: typeof fetch = fetch) {
  const get = async (url: URL) => {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new SourceError([]);
    return response.json() as Promise<unknown>;
  };
  const headerURL = new URL(
    'https://www.data.go.kr/download/columList.json?pk=15012890&ext=JSON&recommendDataYn=Y',
  );
  const headerSchema = z.object({
    totalCount: z.number().int().positive().max(100_000),
    tableVO: z.object({ colNmList: z.array(z.string()), svcTableNm: z.string().min(1) }),
  });
  const header = headerSchema.parse(await get(headerURL));
  const perPage = 10_000;
  const pages = Math.ceil(header.totalCount / perPage);
  const records: unknown[] = [];
  for (let page = 1; page <= pages; page++) {
    const url = new URL('https://www.data.go.kr/download/standard.json');
    for (const [key, value] of Object.entries({
      publicDataPk: '15012890',
      svcTableNm: header.tableVO.svcTableNm,
      totalCount: header.totalCount,
      perPage,
      page,
    }))
      url.searchParams.set(key, String(value));
    for (const column of header.tableVO.colNmList) url.searchParams.append('colNmList', column);
    const rows = z.array(z.record(z.string(), z.unknown())).parse(await get(url));
    if (rows.length !== Math.min(perPage, header.totalCount - (page - 1) * perPage))
      throw new SourceError([]);
    records.push(...rows);
  }
  const after = headerSchema.parse(await get(headerURL));
  if (after.totalCount !== header.totalCount) throw new SourceError([]);
  const pilot = records.filter((row) =>
    String((row as Record<string, unknown>).MANAGE_NO).startsWith('46840-'),
  );
  const fields = [
    'MANAGE_NO',
    'PARK_NM',
    'PARK_SE',
    'RDNMADR',
    'LNMADR',
    'LATITUDE',
    'LONGITUDE',
    'MVM_FCLTY',
    'REFERENCE_DATE',
  ];
  const snapshot = {
    source,
    regionCode: '46840',
    capturedAt: new Date().toISOString(),
    collection: { complete: true, total: header.totalCount, received: records.length, pages },
    expectedCount: pilot.length,
    records: pilot.map((row) =>
      Object.fromEntries(fields.map((key) => [key, (row as Record<string, unknown>)[key]])),
    ),
  };
  normalizeSnapshot(snapshot);
  return snapshot;
}
