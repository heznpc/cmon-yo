import type { Observation } from '../src/server/observability';
import { test, expect, vi } from 'vitest';
import { createApp } from '../src/server/app';
import { renderPage } from '../src/server/render';
import type { PlaceService } from '../src/server/services/place';
import fixture from '../contracts/fixtures/place.json' with { type: 'json' };
import { placeDetailSchema } from '../src/contracts/place';
import { ServiceError } from '../src/server/services/meetup';
import { Suspense, use } from 'react';
const data = placeDetailSchema.parse(fixture),
  id = data.place.id;
function gate<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
function service(weather: PlaceService['weather']): PlaceService {
  return {
    regions: async () => ({ regions: [{ code: '46840', name: '무안군' }] }),
    list: async () => ({ places: [data.place] }),
    info: async (requested) => {
      if (requested !== id) throw new ServiceError(404, 'NOT_FOUND', '시설을 찾을 수 없습니다.');
      return { place: data.place };
    },
    weather,
    detail: async () => data,
  };
}
test('a render error after the shell finishes the stream and releases its request', async () => {
  const events: Observation[] = [];
  const held = gate<void>(),
    cleanup = vi.fn();
  function LateFailure(): never {
    use(held.promise);
    throw new Error('render failed');
  }
  const app = createApp({
    onCleanup: cleanup,
    telemetry: (event) => events.push(event),
    places: service(async () => ({ placeId: id, weather: data.weather })),
    renderer: async () => (reply, state, client, assets, signal) =>
      renderPage(
        reply,
        state,
        client,
        assets,
        signal,
        <main>
          <h1>Required body</h1>
          <Suspense fallback={<p>Optional pending</p>}>
            <LateFailure />
          </Suspense>
        </main>,
      ),
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(origin + '/places'),
      reader = response.body!.getReader();
    expect(await textUntil(reader, 'Required body')).toContain('Optional pending');
    held.resolve();
    while (!(await reader.read()).done) {
      /* consume React's boundary recovery instruction */
    }
    expect(response.status).toBe(200);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'ssr_render_error',
        phase: 'stream',
        requestId: response.headers.get('x-request-id'),
      }),
    );
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  } finally {
    app.server.closeAllConnections();
    await app.close();
  }
});
async function textUntil(reader: ReadableStreamDefaultReader<Uint8Array>, target: string) {
  let text = '';
  while (!text.includes(target)) {
    const next = await reader.read();
    if (next.done) throw new Error('stream ended before required content');
    text += new TextDecoder().decode(next.value);
  }
  return text;
}
test('required facility body precedes held weather; late packet is escaped and no-store', async () => {
  const held = gate<Awaited<ReturnType<PlaceService['weather']>>>(),
    entered = gate<void>(),
    cleanup = vi.fn();
  const app = createApp({
    renderer: async () => renderPage,
    assets: { scripts: ['/client.js'], css: [] },
    onCleanup: cleanup,
    places: service(async () => {
      entered.resolve();
      return held.promise;
    }),
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const pending = fetch(origin + '/places/' + id);
    await entered.promise;
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const reader = response.body!.getReader(),
      first = await textUntil(reader, 'async=""');
    expect(first).toMatch(/<script type="module" src="\/client.js"[^>]* async=""/);
    expect(first.indexOf('<script type="module"')).toBeGreaterThan(
      first.indexOf('id="initial-state"'),
    );
    expect(first).toContain(data.place.name);
    expect(first).toContain(data.place.address);
    expect(first).toContain('날씨를 불러오는 중');
    expect(first).not.toContain('최근에 받은 예보');
    held.resolve({
      placeId: id,
      weather: Object.assign({}, data.weather, {
        note: '</script><script>globalThis.streamAttack=1</script>\u2028&',
      }),
    });
    let rest = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest += new TextDecoder().decode(next.value);
    }
    expect(rest).toContain('data-cmon-stream="weather"');
    expect(rest).toContain('\\u003c/script\\u003e');
    expect(rest).not.toContain('<script>globalThis.streamAttack');
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    const missing = await fetch(origin + '/places/park-46840-99999');
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain('initial-state');
  } finally {
    app.server.closeAllConnections();
    await app.close();
  }
});
test('closing a streamed response aborts optional work and clears render resources once', async () => {
  const entered = gate<void>(),
    aborted = gate<void>(),
    cleanup = vi.fn();
  const app = createApp({
    renderer: async () => renderPage,
    onCleanup: cleanup,
    places: service(
      async (_, signal) =>
        new Promise((_, reject) => {
          entered.resolve();
          signal.addEventListener(
            'abort',
            () => {
              aborted.resolve();
              reject(new Error('private upstream details'));
            },
            { once: true },
          );
        }),
    ),
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 }),
    controller = new AbortController();
  try {
    const pending = fetch(origin + '/places/' + id, { signal: controller.signal });
    await entered.promise;
    const response = await pending;
    await textUntil(response.body!.getReader(), '이 장소의 모임 보기');
    controller.abort();
    await aborted.promise;
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
  } finally {
    app.server.closeAllConnections();
    await app.close();
  }
});
test('optional failure stays inside its region; a stream deadline terminates and releases its work', async () => {
  const cleanup = vi.fn();
  let mode = 'failure';
  const aborted = gate<void>();
  const app = createApp({
    deadlineMs: 200,
    renderer: async () => renderPage,
    onCleanup: cleanup,
    places: service(async (_, signal) => {
      if (mode === 'failure') throw new Error('UPSTREAM_SECRET');
      return new Promise((_, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted.resolve();
            reject(new Error('aborted'));
          },
          { once: true },
        ),
      );
    }),
  });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const failed = await fetch(origin + '/places/' + id),
      html = await failed.text();
    expect(failed.status).toBe(200);
    expect(html).toContain(data.place.name);
    expect(html).not.toContain('UPSTREAM_SECRET');
    expect(html).toContain('failed');
    mode = 'held';
    const response = await fetch(origin + '/places/' + id);
    await expect(response.text()).rejects.toThrow();
    await aborted.promise;
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(2));
  } finally {
    app.server.closeAllConnections();
    await app.close();
  }
});
