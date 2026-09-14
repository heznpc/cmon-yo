import { z } from 'zod';
import { placeSchema, regionCodeSchema, type Place } from '../../contracts/place';

export const source = 'data.go.kr/15012890';
const coordinate = z.string().trim().min(1).transform(Number).pipe(z.number().finite());
const rowSchema = z.object({
  MANAGE_NO: z.string().regex(/^[0-9]{5}-[0-9]{5}$/),
  PARK_NM: z.string().trim().min(1),
  PARK_SE: z.string().trim().min(1),
  RDNMADR: z.string(),
  LNMADR: z.string(),
  LATITUDE: coordinate,
  LONGITUDE: coordinate,
  MVM_FCLTY: z.string(),
  REFERENCE_DATE: z.iso.date(),
  INSTT_NM: z.string().trim().optional(),
});
export const snapshotSchema = z
  .object({
    source: z.literal(source),
    regionCode: regionCodeSchema.nullable(),
    regionCodes: z.array(regionCodeSchema).optional(),
    capturedAt: z.iso.datetime(),
    collection: z
      .object({
        complete: z.literal(true),
        total: z.number().int().positive(),
        received: z.number().int().positive(),
        pages: z.number().int().positive(),
      })
      .refine((v) => v.total === v.received),
    expectedCount: z.number().int().nonnegative(),
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
  const selected =
    parsed.data.regionCodes ?? (parsed.data.regionCode ? [parsed.data.regionCode] : []);
  if (parsed.data.regionCode && (selected.length !== 1 || selected[0] !== parsed.data.regionCode))
    throw new SourceError([]);
  const places: Place[] = [];
  const failures: number[] = [];
  const seen = new Set<string>();
  parsed.data.records.forEach((value, index) => {
    const row = rowSchema.safeParse(value);
    if (
      !row.success ||
      seen.has(row.data.MANAGE_NO) ||
      (selected.length > 0 && !selected.includes(row.data.MANAGE_NO.slice(0, 5)))
    ) {
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
      ...(r.INSTT_NM ? { regionName: r.INSTT_NM } : {}),
    });
    if (!place.success) failures.push(index + 1);
    else places.push(place.data);
  });
  if (failures.length) throw new SourceError(failures);
  return places;
}

// The portal's public file-download protocol, observed on 2026-09-13.
// Fetch every page before publishing a regional snapshot. Absence never deletes DB rows.
export function facilityRegionCodes(value = ''): string[] {
  if (!value.trim()) return [];
  return [...new Set(z.array(regionCodeSchema).parse(value.split(',').map((code) => code.trim())))];
}

function deduplicateRows(rows: Record<string, unknown>[]) {
  const selected = new Map<string, Record<string, unknown>>();
  const result: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = String(row.MANAGE_NO ?? '');
    if (!/^[0-9]{5}-[0-9]{5}$/.test(id)) {
      result.push(row);
      continue;
    }
    const previous = selected.get(id);
    const institution = String(row.INSTT_NM ?? '');
    const previousInstitution = String(previous?.INSTT_NM ?? '');
    // The live file repeats a management number during administrative changes.
    // Prefer the row with the most specific institution label; normalization
    // still rejects malformed rows and conflicting duplicate snapshots.
    if (!previous) {
      selected.set(id, row);
      result.push(row);
    } else if (institution.split(/\s+/).length > previousInstitution.split(/\s+/).length) {
      const index = result.indexOf(previous);
      if (index >= 0) result[index] = row;
      selected.set(id, row);
    }
  }
  return result;
}

export async function collectParks(fetcher: typeof fetch = fetch, regionCodes: string[] = []) {
  const selected = z.array(regionCodeSchema).parse(regionCodes);
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
  const regional = selected.length
    ? records.filter((row) =>
        selected.includes(String((row as Record<string, unknown>).MANAGE_NO).slice(0, 5)),
      )
    : records;
  const normalizedRegional = deduplicateRows(regional as Record<string, unknown>[]);
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
    'INSTT_NM',
  ];
  const snapshot = {
    source,
    regionCode: selected.length === 1 ? selected[0] : null,
    regionCodes: selected,
    capturedAt: new Date().toISOString(),
    collection: { complete: true, total: header.totalCount, received: records.length, pages },
    expectedCount: normalizedRegional.length,
    records: normalizedRegional.map((row) =>
      Object.fromEntries(fields.map((key) => [key, (row as Record<string, unknown>)[key]])),
    ),
  };
  normalizeSnapshot(snapshot);
  return snapshot;
}
