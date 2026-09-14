import type { z } from 'zod';
import { apiErrorSchema } from '../contracts/http';
import { meetupDetailSchema } from '../contracts/meetup';
import {
  placeDetailSchema,
  regionListSchema,
  type PlaceFilters,
  placeListSchema,
  placeInfoSchema,
  placeWeatherSchema,
  favoritePlacesSchema,
  favoritePlaceResultSchema,
  type FavoritePlaces,
  type FavoritePlaceResult,
} from '../contracts/place';

export class PublicApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'PublicApiError';
  }
}

// The browser uses same-origin HTTP; the SSR loaders call services directly.
// Injecting fetch also lets contract tests use a real independently listening API.
export function createPublicAPI(fetcher: typeof fetch = fetch) {
  async function read<T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    messages: { unavailable: string; invalid: string },
  ): Promise<T> {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetcher(path, { signal, headers: { Accept: 'application/json' } });
    } catch {
      signal.throwIfAborted();
      throw new PublicApiError(messages.unavailable, null, 'NETWORK_ERROR', true);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      signal.throwIfAborted();
      // A gateway may return HTML or an empty error body. HTTP status still applies.
    }
    signal.throwIfAborted();
    if (!response.ok) {
      const envelope = apiErrorSchema.safeParse(body);
      throw new PublicApiError(
        messages.unavailable,
        response.status,
        envelope.success ? envelope.data.error.code : 'HTTP_ERROR',
        envelope.success ? envelope.data.error.retryable : response.status >= 500,
        envelope.success ? envelope.data.error.requestId : undefined,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new PublicApiError(messages.invalid, response.status, 'INVALID_RESPONSE', false);
    return parsed.data;
  }
  async function detail<T>(request: Promise<T>): Promise<T | null> {
    try {
      return await request;
    } catch (error) {
      // Absence replaces this query's prior success; later failures must not revive it.
      if (error instanceof PublicApiError && error.status === 404) return null;
      throw error;
    }
  }
  const placeMessages = {
    unavailable: '시설을 불러오지 못했습니다. 다시 시도해 주세요.',
    invalid: '시설을 불러오지 못했습니다. 다시 시도해 주세요.',
  };
  return {
    meetup: (id: string, signal: AbortSignal) =>
      detail(
        read(`/api/v1/meetups/${encodeURIComponent(id)}`, meetupDetailSchema, signal, {
          unavailable: '연결에 실패했습니다. 다시 시도해 주세요.',
          invalid: '모임 응답을 읽을 수 없습니다.',
        }),
      ),
    regions: (signal: AbortSignal) =>
      read('/api/v1/regions', regionListSchema, signal, placeMessages),
    places: (signal: AbortSignal, filters: PlaceFilters = { page: 0 }) => {
      const params = new URLSearchParams();
      if (filters.regionCode) params.set('regionCode', filters.regionCode);
      if (filters.page) params.set('page', String(filters.page));
      return read(
        '/api/v1/places' + (params.size ? '?' + params : ''),
        placeListSchema,
        signal,
        placeMessages,
      );
    },
    placeInfo: (id: string, signal: AbortSignal) =>
      detail(
        read(
          `/api/v1/places/${encodeURIComponent(id)}/info`,
          placeInfoSchema.refine((data) => data.place.id === id),
          signal,
          placeMessages,
        ),
      ),
    weather: (id: string, signal: AbortSignal) =>
      detail(
        read(
          `/api/v1/places/${encodeURIComponent(id)}/weather`,
          placeWeatherSchema.refine((data) => data.placeId === id),
          signal,
          {
            unavailable: '날씨를 불러오지 못했습니다. 다시 시도해 주세요.',
            invalid: '날씨 응답을 읽을 수 없습니다.',
          },
        ),
      ),
    place: (id: string, signal: AbortSignal) =>
      detail(
        read(`/api/v1/places/${encodeURIComponent(id)}`, placeDetailSchema, signal, placeMessages),
      ),
    favoritePlaces: async (signal: AbortSignal): Promise<FavoritePlaces | null> => {
      try {
        return await read('/api/v1/me/place-favorites', favoritePlacesSchema, signal, {
          unavailable: '찜 목록을 불러오지 못했습니다. 다시 시도해 주세요.',
          invalid: '찜 목록을 읽을 수 없습니다.',
        });
      } catch (error) {
        if (error instanceof PublicApiError && error.status === 401) return null;
        throw error;
      }
    },
    setFavorite: async (
      id: string,
      favorite: boolean,
      signal: AbortSignal,
    ): Promise<FavoritePlaceResult> => {
      signal.throwIfAborted();
      let response: Response;
      try {
        response = await fetcher(`/api/v1/me/place-favorites/${encodeURIComponent(id)}`, {
          method: favorite ? 'PUT' : 'DELETE',
          signal,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
      } catch {
        signal.throwIfAborted();
        throw new PublicApiError(
          '찜을 저장하지 못했습니다. 다시 시도해 주세요.',
          null,
          'NETWORK_ERROR',
          true,
        );
      }
      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        const envelope = apiErrorSchema.safeParse(body);
        throw new PublicApiError(
          envelope.success
            ? envelope.data.error.message
            : '찜을 저장하지 못했습니다. 다시 시도해 주세요.',
          response.status,
          envelope.success ? envelope.data.error.code : 'HTTP_ERROR',
          response.status >= 500,
        );
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new PublicApiError(
          '찜 응답을 읽을 수 없습니다.',
          response.status,
          'INVALID_RESPONSE',
          false,
        );
      }
      const parsed = favoritePlaceResultSchema.safeParse(body);
      if (!parsed.success || parsed.data.id !== id || parsed.data.favorite !== favorite)
        throw new PublicApiError(
          '찜 응답을 읽을 수 없습니다.',
          response.status,
          'INVALID_RESPONSE',
          false,
        );
      return parsed.data;
    },
  };
}

export const publicAPI = createPublicAPI();
