import type { z } from 'zod';
import { apiErrorSchema } from '../contracts/http';
import { meetupDetailSchema } from '../contracts/meetup';
import { placeDetailSchema, placeListSchema } from '../contracts/place';

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
    places: (signal: AbortSignal) => read('/api/v1/places', placeListSchema, signal, placeMessages),
    place: (id: string, signal: AbortSignal) =>
      detail(
        read(`/api/v1/places/${encodeURIComponent(id)}`, placeDetailSchema, signal, placeMessages),
      ),
  };
}

export const publicAPI = createPublicAPI();
