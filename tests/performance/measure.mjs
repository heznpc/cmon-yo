/* global setTimeout, fetch, window, document, performance, PerformanceObserver, MutationObserver, requestAnimationFrame */
import { chromium } from '@playwright/test';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { cpus, totalmem, release, loadavg } from 'node:os';
const origin = process.env.PERF_ORIGIN ?? 'http://127.0.0.1:3120';
const label = process.argv[2] ?? 'before',
  repetitions = Number(process.env.PERF_REPETITIONS ?? 10),
  warmups = 2;
await mkdir('.cache/performance', { recursive: true });
const setup = await fetch(origin + '/_perf/setup').then((r) => r.json());
const control = async (body) => {
  const r = await fetch(origin + '/_perf/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw Error('Control failed');
};
const stats = () => fetch(origin + '/_perf/stats').then((r) => r.json());
const browser = await chromium.launch();
const results = {
  label,
  environment: {
    startedAt: new Date().toISOString(),
    osRelease: release(),
    cpu: cpus()[0].model,
    memoryGiB: totalmem() / 1073741824,
    startLoadAverage: loadavg(),
    node: process.version,
    chromium: browser.version(),
    viewport: '1280x900',
    network: 'HTTP loopback; no bandwidth or CPU throttling; local synthetic weather HTTP',
    repetitions,
    warmups,
    facilities: setup.places,
    meetings: setup.meetings,
  },
  documents: [],
  journeys: [],
  concurrency: [],
};
if (process.env.PERF_RESUME === '1')
  Object.assign(results, JSON.parse(await readFile(`.cache/performance/${label}.json`, 'utf8')));
const errors = [];
async function context(user) {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (user) {
    const r = await c.request.post(origin + '/api/auth/sign-in/email', {
      headers: { origin },
      data: { email: user.email, password: user.password },
    });
    if (!r.ok()) throw Error('Login failed');
  }
  await c.addInitScript(() => {
    window.__perf = { body: null, lcp: null, fetching: 0 };
    const originalFetch = window.fetch;
    window.fetch = (...args) => {
      const observation = window.__perf;
      observation.fetching++;
      return originalFetch(...args).finally(() => observation.fetching--);
    };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__perf.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    const observer = new MutationObserver(() => {
      const h = document.querySelector('main h1');
      if (
        h &&
        h.textContent?.trim() &&
        !['시설 상세', '모임 상세'].includes(h.textContent.trim()) &&
        h.getBoundingClientRect().height > 0 &&
        window.__perf.body === null
      ) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            window.__perf.body ??= performance.now();
          }),
        );
      }
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  return c;
}
async function instrument(page) {
  const network = [];
  const pending = new Set();
  let changedAt = performance.now();
  const finished = (id) => {
    pending.delete(id);
    changedAt = performance.now();
  };
  network.settle = async () => {
    const start = performance.now();
    for (;;) {
      const settled = await page
        .evaluate(() => document.readyState === 'complete' && window.__perf.fetching === 0)
        .catch(() => false);
      if (settled && performance.now() - changedAt >= 500) {
        // Chromium can omit terminal CDP events for cancelled fetches. The
        // document is loaded and all observed fetch promises have settled.
        for (const id of pending) {
          const r = req.get(id);
          if (r.url.startsWith(origin)) network.push({ ...r, bytes: 0, abandoned: true });
        }
        pending.clear();
        return;
      }
      if (performance.now() - start > 15000) throw Error('Current document fetches did not settle');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  const req = new Map();
  // A navigation can destroy an old renderer before CDP emits loadingFailed.
  // Retired requests are counted separately; they must not stall the next page.
  cdp.on('Page.frameNavigated', ({ frame }) => {
    if (frame.parentId) return;
    for (const id of pending) {
      const r = req.get(id);
      if (r.loaderId && r.loaderId !== frame.loaderId) {
        finished(id);
        if (r.url.startsWith(origin)) network.push({ ...r, bytes: 0, abandoned: true });
      }
    }
  });
  cdp.on('Network.requestWillBeSent', (e) => {
    pending.add(e.requestId);
    changedAt = performance.now();
    req.set(e.requestId, { type: e.type, url: e.request.url, loaderId: e.loaderId });
  });
  cdp.on('Network.loadingFailed', (e) => finished(e.requestId));
  cdp.on('Network.loadingFinished', (e) => {
    if (!pending.has(e.requestId)) return;
    finished(e.requestId);
    const r = req.get(e.requestId);
    if (r && r.url.startsWith(origin)) network.push({ ...r, bytes: e.encodedDataLength });
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/Hydration|hydration|Encountered a script tag/.test(m.text()) && m.type() === 'error')
      errors.push(m.text());
  });
  return network;
}
function networkSummary(network) {
  return {
    abandoned: network.filter((r) => r.abandoned).length,
    html: network.filter((r) => r.type === 'Document').length,
    api: network.filter((r) => r.url.includes('/api/')).length,
    requests: network.length,
    bytes: network.reduce((n, r) => n + r.bytes, 0),
  };
}
for (const mode of ['normal', 'delay', 'failure', 'timeout', 'hit']) {
  if (results.documents.filter((r) => r.mode === mode).length === repetitions) continue;
  for (let i = -warmups; i < repetitions; i++) {
    await control({
      mode: mode === 'hit' ? 'normal' : mode,
      reset: true,
      resetAuth: true,
      metrics: true,
    });
    if (mode === 'hit')
      await fetch(origin + '/api/v1/places/park-46840-00023').then((r) => r.text());
    const c = await context(),
      page = await c.newPage(),
      network = await instrument(page);
    await page.goto(origin + '/places/park-46840-00023', { waitUntil: 'commit' });
    await page.getByRole('heading', { name: '근린공원 36', exact: true }).waitFor();
    await page.getByRole('link', { name: '이 장소의 모임 보기', exact: true }).waitFor();
    // The same real link is the readiness target; a generic shell never qualifies.
    const usable = await page.evaluate(() => performance.now());
    await page.waitForFunction(() =>
      [...document.querySelectorAll('button')].some(
        (b) => !b.disabled && /^(시설.*새로고침|다시 시도)$/.test(b.textContent.trim()),
      ),
    );
    const hydration = await page.evaluate(() => performance.now());
    await network.settle();
    const timing = await page.evaluate(() => ({
      ttfb: performance.getEntriesByType('navigation')[0].responseStart,
      body: window.__perf.body,
      lcp: window.__perf.lcp,
    }));
    const server = await stats();
    if (i >= 0)
      results.documents.push({
        mode,
        ...timing,
        usable,
        hydration,
        ...networkSummary(network),
        providerCalls: server.calls,
        weatherEvents: server.weatherEvents ?? null,
        providerFailures: server.upstreamFailures,
        providerClosed: server.upstreamClosed,
      });
    await c.close();
  }
  await writeFile(`.cache/performance/${label}.json`, JSON.stringify(results, null, 2));
  console.log('documents', mode, 'measured');
}
for (const identity of ['anonymous', 'signed-in', 'switch']) {
  if (results.journeys.filter((r) => r.identity === identity).length === repetitions) continue;
  for (let i = -warmups; i < repetitions; i++) {
    await control({ mode: 'normal', reset: true, resetAuth: true, metrics: true });
    const c = await context(identity === 'anonymous' ? null : setup.users[1]),
      page = await c.newPage(),
      network = await instrument(page);
    const steps = [];
    async function step(name, action, ready) {
      const t = performance.now();
      await action();
      await ready();
      steps.push({ name, ms: performance.now() - t });
    }
    await page.goto(origin + '/places');
    await step(
      'facility-detail',
      () => page.getByRole('link', { name: '근린공원 36', exact: true }).click(),
      () => page.getByRole('link', { name: '이 장소의 모임 보기' }).waitFor(),
    );
    await step(
      'related-meetings',
      () => page.getByRole('link', { name: '이 장소의 모임 보기' }).click(),
      () => page.getByRole('link', { name: '[성능 시험] 운동 약속 01', exact: true }).waitFor(),
    );
    await step(
      'detail-return',
      () => page.goBack(),
      () => page.getByRole('heading', { name: '근린공원 36', exact: true }).waitFor(),
    );
    await step(
      'facility-list-return',
      () => page.goBack(),
      () => page.getByRole('link', { name: '근린공원 36', exact: true }).waitFor(),
    );
    await page.getByRole('link', { name: '모임', exact: true }).click();
    await step(
      'meeting-detail',
      () => page.getByRole('link', { name: '[성능 시험] 운동 약속 01', exact: true }).click(),
      () => page.getByRole('heading', { name: '[성능 시험] 운동 약속 01', exact: true }).waitFor(),
    );
    if (identity !== 'anonymous') {
      await step(
        'join',
        () => page.getByRole('button', { name: '참여하기', exact: true }).click(),
        () => page.getByRole('button', { name: '참여 취소', exact: true }).waitFor(),
      );
      await page.getByRole('button', { name: '참여 취소', exact: true }).click();
      await step(
        'leave',
        () => page.getByRole('button', { name: '취소 확정' }).click(),
        () => page.getByRole('button', { name: '참여하기', exact: true }).waitFor(),
      );
      await step(
        'mine',
        () => page.getByRole('link', { name: '내 모임', exact: true }).click(),
        () => page.getByRole('link', { name: '[성능 시험] 운동 약속 01', exact: true }).waitFor(),
      );
    }
    if (identity === 'switch') {
      await page.getByRole('link', { name: '내 계정', exact: true }).click();
      await page.getByRole('button', { name: '로그아웃', exact: true }).click();
      // Sign-out intentionally creates a new document. Wait for its client work
      // before entering the next credentials into the hydrated form.
      await network.settle();
      await page.getByLabel('이메일', { exact: true }).fill(setup.users[0].email);
      await page.getByLabel(/^비밀번호/).fill(setup.users[0].password);
      await step(
        'login-switch',
        () => page.getByRole('button', { name: '로그인', exact: true }).click(),
        () => page.getByRole('button', { name: '로그아웃', exact: true }).waitFor(),
      );
    }
    await network.settle();
    if (i >= 0) results.journeys.push({ identity, steps, ...networkSummary(network) });
    await c.close();
  }
  await writeFile(`.cache/performance/${label}.json`, JSON.stringify(results, null, 2));
  console.log('journey', identity, 'measured');
}
// Completion latency of HTTP facility requests (includes weather in baseline).
for (const mode of ['delay', 'failure', 'hit'])
  for (const concurrency of [1, 8, 32]) {
    if (results.concurrency.some((r) => r.mode === mode && r.concurrency === concurrency)) continue;
    const runs = [];
    for (let wave = -1; wave < 5; wave++) {
      await control({
        mode: mode === 'hit' ? 'normal' : mode,
        reset: true,
        resetAuth: true,
        metrics: true,
      });
      if (mode === 'hit')
        await fetch(origin + '/api/v1/places/park-46840-00023').then((r) => r.text());
      const requests = await Promise.all(
        Array.from({ length: concurrency }, async () => {
          const t = performance.now();
          try {
            const r = await fetch(origin + '/api/v1/places/park-46840-00023');
            await r.text();
            return { ms: performance.now() - t, status: r.status };
          } catch {
            return { ms: performance.now() - t, status: 0 };
          }
        }),
      );
      if (wave >= 0) runs.push({ requests, server: await stats() });
    }
    results.concurrency.push({ mode, concurrency, runs });
    console.log('concurrency', mode, concurrency, 'measured');
  }
results.errors = errors;
results.environment.finishedAt = new Date().toISOString();
results.environment.endLoadAverage = loadavg();
await mkdir('.cache/performance', { recursive: true });
await writeFile(`.cache/performance/${label}.json`, JSON.stringify(results, null, 2));
await browser.close();
console.log(`Saved ${label}; browser errors: ${errors.length}`);
