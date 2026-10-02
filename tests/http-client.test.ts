import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { apiRequest } from '../src/api/http';

afterEach(() => vi.unstubAllGlobals());

test('an HTML gateway timeout keeps its status for uncertain command recovery', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Timeout</h1>', { status: 408 })));
  await expect(apiRequest('/api/v1/community/commands', z.object({ id: z.string() })))
    .rejects.toMatchObject({ status: 408, code: 'UNAVAILABLE' });
});

test('empty authentication errors and malformed success responses have actionable failures', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(apiRequest('/api/v1/me', z.object({ user: z.null() })))
    .rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  await expect(apiRequest('/api/v1/me', z.object({ user: z.null() })))
    .rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' });
});

test('network failure is distinct from a confirmed server rejection', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(apiRequest('/api/v1/community/commands', z.object({ id: z.string() })))
    .rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
});
