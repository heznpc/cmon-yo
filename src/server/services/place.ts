import type pg from 'pg';
import {
  placeDetailSchema,
  regionListSchema,
  type PlaceFilters,
  placeListSchema,
  placeSchema,
  type PlaceDetail,
  type PlaceInfo,
  type PlaceWeather,
  type Place,
} from '../../contracts/place';
import { source } from '../facilities/source';
import type { WeatherService } from '../weather/kma';
import { ServiceError } from './meetup';

export type PlaceService = {
  list(
    signal: AbortSignal,
    filters?: PlaceFilters,
  ): Promise<{ places: Place[]; nextPage?: number | null }>;
  regions(signal: AbortSignal): Promise<{ regions: { code: string; name: string }[] }>;
  detail(id: string, signal: AbortSignal): Promise<PlaceDetail>;
  info(id: string, signal: AbortSignal): Promise<PlaceInfo>;
  weather(place: Place, signal: AbortSignal): Promise<PlaceWeather>;
  favorites?(user: string, signal: AbortSignal): Promise<{ placeIds: string[] }>;
  setFavorite?(
    user: string,
    id: string,
    favorite: boolean,
  ): Promise<{ id: string; favorite: boolean }>;
};
export function databasePlaces(pool: pg.Pool | undefined, weather: WeatherService): PlaceService {
  const database = () => {
    if (!pool) throw new ServiceError(503, 'UNAVAILABLE', '시설을 불러오지 못했습니다.');
    return pool;
  };
  const info = async (id: string, signal: AbortSignal): Promise<PlaceInfo> => {
    signal.throwIfAborted();
    const result = await database().query(
      'SELECT document FROM places WHERE source = $1 AND source_key = $2',
      [source, id.slice(5)],
    );
    signal.throwIfAborted();
    if (!result.rowCount) throw new ServiceError(404, 'NOT_FOUND', '시설을 찾을 수 없습니다.');
    return { place: placeSchema.parse(result.rows[0].document) };
  };
  const forecast = async (place: Place, signal: AbortSignal): Promise<PlaceWeather> => ({
    placeId: place.id,
    weather: await weather(place.latitude, place.longitude, signal),
  });
  return {
    info,
    weather: forecast,
    async regions(signal) {
      signal.throwIfAborted();
      const { rows } = await database().query(
        `SELECT left(source_key, 5) AS code, min(document->>'regionName') AS name, min(document->>'address') AS address
         FROM places WHERE source=$1 GROUP BY left(source_key, 5) ORDER BY code`,
        [source],
      );
      signal.throwIfAborted();
      return regionListSchema.parse({
        regions: rows.map((row) => {
          const parts = String(row.address ?? '')
            .trim()
            .split(/\s+/);
          const label = parts.slice(0, parts[2]?.endsWith('구') ? 3 : 2).join(' ');
          return { code: row.code, name: row.name || label || row.code };
        }),
      });
    },
    async list(signal, filters = { page: 0 }) {
      signal.throwIfAborted();
      const hasLocation = filters.latitude != null && filters.longitude != null;
      const result = hasLocation
        ? await database().query(
            `SELECT document FROM places
             WHERE source = $1 AND ($2::text IS NULL OR left(source_key,5)=$2)
             ORDER BY
               6371 * acos(least(1, greatest(-1,
                 cos(radians($3)) * cos(radians((document->>'latitude')::double precision)) *
                 cos(radians((document->>'longitude')::double precision) - radians($4)) +
                 sin(radians($3)) * sin(radians((document->>'latitude')::double precision))
               )))
             LIMIT 101 OFFSET $5`,
            [
              source,
              filters.regionCode ?? null,
              filters.latitude,
              filters.longitude,
              filters.page * 100,
            ],
          )
        : await database().query(
            `SELECT document FROM places WHERE source = $1 AND ($2::text IS NULL OR left(source_key,5)=$2)
             ORDER BY source_key DESC LIMIT 101 OFFSET $3`,
            [source, filters.regionCode ?? null, filters.page * 100],
          );
      signal.throwIfAborted();
      return placeListSchema.parse({
        places: result.rows.slice(0, 100).map((r) => r.document),
        nextPage: result.rows.length > 100 ? filters.page + 1 : null,
      });
    },
    async detail(id, signal) {
      const { place } = await info(id, signal);
      return placeDetailSchema.parse({ place, weather: (await forecast(place, signal)).weather });
    },
    async favorites(user, signal) {
      signal.throwIfAborted();
      const result = await database().query(
        'SELECT place_id FROM place_favorites WHERE user_id = $1 ORDER BY created_at, place_id',
        [user],
      );
      signal.throwIfAborted();
      return { placeIds: result.rows.map((row) => row.place_id) };
    },
    async setFavorite(user, id, favorite) {
      const place = await database().query(
        'SELECT 1 FROM places WHERE source = $1 AND source_key = $2',
        [source, id.slice(5)],
      );
      if (!place.rowCount) throw new ServiceError(404, 'NOT_FOUND', '시설을 찾을 수 없습니다.');
      if (favorite)
        await database().query(
          'INSERT INTO place_favorites(user_id, place_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user, id],
        );
      else
        await database().query('DELETE FROM place_favorites WHERE user_id = $1 AND place_id = $2', [
          user,
          id,
        ]);
      return { id, favorite };
    },
  };
}
