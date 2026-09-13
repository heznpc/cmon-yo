import type pg from 'pg';
import {
  placeDetailSchema,
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
  list(signal: AbortSignal): Promise<{ places: Place[] }>;
  detail(id: string, signal: AbortSignal): Promise<PlaceDetail>;
  info(id: string, signal: AbortSignal): Promise<PlaceInfo>;
  weather(place: Place, signal: AbortSignal): Promise<PlaceWeather>;
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
      const { place } = await info(id, signal);
      return placeDetailSchema.parse({ place, weather: (await forecast(place, signal)).weather });
    },
  };
}
