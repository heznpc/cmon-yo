import type pg from 'pg';
import {
  placeDetailSchema,
  placeListSchema,
  placeSchema,
  type PlaceDetail,
  type Place,
} from '../../contracts/place';
import { source } from '../facilities/source';
import type { WeatherService } from '../weather/kma';
import { ServiceError } from './meetup';

export type PlaceService = {
  list(signal: AbortSignal): Promise<{ places: Place[] }>;
  detail(id: string, signal: AbortSignal): Promise<PlaceDetail>;
};
export function databasePlaces(pool: pg.Pool | undefined, weather: WeatherService): PlaceService {
  const database = () => {
    if (!pool) throw new ServiceError(503, 'UNAVAILABLE', '시설을 불러오지 못했습니다.');
    return pool;
  };
  return {
    async list(signal) {
      signal.throwIfAborted();
      const result = await database().query(
        'SELECT document FROM places WHERE source = $1 ORDER BY source_key DESC LIMIT 100',
        [source],
      );
      signal.throwIfAborted();
      return placeListSchema.parse({ places: result.rows.map((r) => r.document) });
    },
    async detail(id, signal) {
      signal.throwIfAborted();
      const result = await database().query(
        'SELECT document FROM places WHERE source = $1 AND source_key = $2',
        [source, id.slice(5)],
      );
      signal.throwIfAborted();
      if (!result.rowCount) throw new ServiceError(404, 'NOT_FOUND', '시설을 찾을 수 없습니다.');
      const place = placeSchema.parse(result.rows[0].document);
      return placeDetailSchema.parse({
        place,
        weather: await weather(place.latitude, place.longitude, signal),
      });
    },
  };
}
