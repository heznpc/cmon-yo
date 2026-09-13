import { z } from 'zod';

export const placeIdSchema = z.string().regex(/^park-46840-\d{5}$/);
export const placeSchema = z.object({
  id: placeIdSchema,
  name: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  address: z.string().trim().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  exerciseFacilities: z.array(z.string().min(1)),
  sourceDate: z.iso.date(),
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
export const placeListSchema = z.object({ places: z.array(placeSchema) });
export const placeDetailSchema = z.object({ place: placeSchema, weather: weatherSchema });
export type Place = z.infer<typeof placeSchema>;
export type WeatherFacts = z.infer<typeof weatherFactsSchema>;
export type Weather = z.infer<typeof weatherSchema>;
export type PlaceDetail = z.infer<typeof placeDetailSchema>;
export const placesKey = ['places', '46840'] as const;
export const placeKey = (id: string) => ['place', id] as const;
export const placeSourceURL = 'https://www.data.go.kr/data/15012890/standard.do';
// Independent units for new clients; the combined detail remains compatible.
export const placeInfoSchema = z.object({ place: placeSchema });
export const placeWeatherSchema = z.object({ placeId: placeIdSchema, weather: weatherSchema });
export type PlaceInfo = z.infer<typeof placeInfoSchema>;
export type PlaceWeather = z.infer<typeof placeWeatherSchema>;
export const weatherKey = (id: string) => ['weather', id] as const;
