import { z } from 'zod';

export const regionCodeSchema = z.string().regex(/^[0-9]{5}$/);
export const placeIdSchema = z.string().regex(/^park-[0-9]{5}-[0-9]{5}$/);
export const regionOfPlace = (id: string) => placeIdSchema.parse(id).slice(5, 10);
export const regionListSchema = z.object({
  regions: z.array(z.object({ code: regionCodeSchema, name: z.string().min(1) })),
});
export const regionsKey = ['regions'] as const;
export const placeFiltersSchema = z.object({
  regionCode: regionCodeSchema.optional(),
  page: z.coerce.number().int().min(0).max(10000).default(0),
});
export type PlaceFilters = z.infer<typeof placeFiltersSchema>;
export const placeSchema = z.object({
  id: placeIdSchema,
  name: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  address: z.string().trim().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  exerciseFacilities: z.array(z.string().min(1)),
  sourceDate: z.iso.date(),
  regionName: z.string().trim().min(1).optional(),
});
export const weatherFactsSchema = z.object({
  temperatureC: z.number().min(-90).max(60).nullable(),
  precipitationProbabilityPercent: z.number().min(0).max(100).nullable(),
  precipitationType: z.enum(['none', 'rain', 'snow', 'mixed', 'unknown']),
  windSpeedMetersPerSecond: z.number().min(0).max(150).nullable(),
  issuedAt: z.iso.datetime({ precision: 3 }),
  validAt: z.iso.datetime({ precision: 3 }),
  fetchedAt: z.iso.datetime({ precision: 3 }),
});
export const weatherSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('fresh'), facts: weatherFactsSchema }),
  z.object({ status: z.literal('stale'), facts: weatherFactsSchema }),
  z.object({ status: z.literal('unavailable'), facts: z.null() }),
]);
export const placeListSchema = z.object({
  places: z.array(placeSchema),
  nextPage: z.number().int().nonnegative().nullable().optional(),
});
export const placeDetailSchema = z.object({ place: placeSchema, weather: weatherSchema });
export type Place = z.infer<typeof placeSchema>;
export type WeatherFacts = z.infer<typeof weatherFactsSchema>;
export type Weather = z.infer<typeof weatherSchema>;
export type PlaceDetail = z.infer<typeof placeDetailSchema>;
export const placesKey = ['places'] as const;
export const placeListKey = (filters: PlaceFilters) =>
  !filters.regionCode && filters.page === 0 ? placesKey : ([...placesKey, filters] as const);
export const placeKey = (id: string) => ['place', id] as const;
export const placeSourceURL = 'https://www.data.go.kr/data/15012890/standard.do';
// Independent units for new clients; the combined detail remains compatible.
export const placeInfoSchema = z.object({ place: placeSchema });
export const placeWeatherSchema = z.object({ placeId: placeIdSchema, weather: weatherSchema });
export type PlaceInfo = z.infer<typeof placeInfoSchema>;
export type PlaceWeather = z.infer<typeof placeWeatherSchema>;
export const weatherKey = (id: string) => ['weather', id] as const;
export const favoritePlacesSchema = z.object({ placeIds: z.array(placeIdSchema) });
export type FavoritePlaces = z.infer<typeof favoritePlacesSchema>;
export const favoritePlaceResultSchema = z.object({ id: placeIdSchema, favorite: z.boolean() });
export type FavoritePlaceResult = z.infer<typeof favoritePlaceResultSchema>;
export const favoritePlacesKey = ['private', 'place-favorites'] as const;
