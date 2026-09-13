/* global fetch, performance */
import { cpus, totalmem, release, loadavg } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { direct, agent, request, control, stats, signIn } from './https-client.mjs';
const setup = await fetch(direct + '/_perf/setup').then((r) => r.json());
// Separate setup budget from the preceding transport test; production limits stay enabled.
await control({ resetAuth: true });
const sessions = await Promise.all(setup.users.map(signIn));
const durationMs = Number(process.env.LOAD_TRIAL_MS ?? 5000);
if (!Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 60000)
  throw Error('LOAD_TRIAL_MS must be 1000..60000');
const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
};
const routes = [
  '/api/v1/places',
  '/api/v1/meetups',
  '/api/v1/posts',
  '/api/v1/places/park-46840-00023/weather',
  '/places/park-46840-00023',
  '/community',
  '/api/v1/me/meetups',
  '/api/v1/me/profile',
];
const result = {
  environment: {
    startedAt: new Date().toISOString(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
      ? 'modified'
      : 'clean',
    node: process.version,
    os: release(),
    cpu: cpus()[0].model,
    logicalCPUs: cpus().length,
    ramGiB: totalmem() / 1073741824,
    initialLoadAverage: loadavg(),
    protocol:
      'HTTP/1.1 TLS verified local CA, Caddy proxy, keep-alive, gzip; same Mac load generator/Node/PostgreSQL',
    model:
      'closed loop: one outstanding request per worker, round-robin routes; 1s warm-up, 3 trials per cell, requests drain after trial end',
    trialMs: durationMs,
    routes,
    places: setup.places,
    meetings: setup.meetings,
    posts: setup.posts,
    comments: setup.comments,
    accounts: 2,
    exclusions:
      'public deployment, login/mutation throughput, realistic think time, network throttling, operation capacity',
  },
  cells: [],
};
async function wave(concurrency, ms) {
  const start = performance.now(),
    samples = [];
  await Promise.all(
    Array.from({ length: concurrency }, async (_, worker) => {
      let index = worker;
      while (performance.now() - start < ms) {
        const path = routes[index++ % routes.length];
        const account = worker % 2;
        try {
          const r = await request(path, {
            headers: {
              cookie: sessions[account].cookie,
              'x-cmon-user': setup.users[account].id,
              'accept-encoding': 'gzip',
            },
          }).promise;
          let valid = r.status === 200,
            weather = null;
          if (valid && path.startsWith('/api/')) {
            const data = JSON.parse(r.text);
            if (path === '/api/v1/me/meetups') valid = data.userId === setup.users[account].id;
            if (path === '/api/v1/me/profile') valid = data.userId === setup.users[account].id;
            if (path.endsWith('/weather')) weather = data.weather.status;
          }
          samples.push({
            path,
            status: r.status,
            valid,
            weather,
            ms: r.durationMs,
            ttfb: r.firstByteMs,
            bytes: r.bytes,
          });
        } catch {
          samples.push({
            path,
            status: 0,
            valid: false,
            weather: null,
            ms: null,
            ttfb: null,
            bytes: 0,
          });
        }
      }
    }),
  );
  const elapsedMs = performance.now() - start;
  const statuses = {},
    weather = {};
  for (const s of samples) {
    statuses[s.status] = (statuses[s.status] ?? 0) + 1;
    if (s.weather) weather[s.weather] = (weather[s.weather] ?? 0) + 1;
  }
  const times = samples.filter((x) => x.ms !== null);
  return {
    n: samples.length,
    elapsedMs,
    rps: samples.length / (elapsedMs / 1000),
    errors: samples.filter((x) => !x.valid).length,
    statuses,
    weather,
    p50: quantile(
      times.map((x) => x.ms),
      0.5,
    ),
    p95: quantile(
      times.map((x) => x.ms),
      0.95,
    ),
    ttfbP95: quantile(
      times.map((x) => x.ttfb),
      0.95,
    ),
    responseBodyBytes: samples.reduce((n, s) => n + s.bytes, 0),
    byRoute: routes.map((path) => {
      const rows = times.filter((x) => x.path === path);
      return {
        path,
        n: rows.length,
        p50: quantile(
          rows.map((x) => x.ms),
          0.5,
        ),
        p95: quantile(
          rows.map((x) => x.ms),
          0.95,
        ),
        errors: samples.filter((x) => x.path === path && !x.valid).length,
      };
    }),
  };
}
try {
  for (const mode of ['normal', 'delay', 'failure']) {
    for (const concurrency of [1, 8, 32]) {
      const trials = [];
      await control({
        mode,
        reset: true,
        ttlMs: mode === 'normal' ? 300000 : 0,
        weatherDeadlineMs: 2500,
        delayMs: 700,
      });
      await wave(concurrency, 1000);
      for (let trial = 0; trial < 3; trial++) {
        await control({ metrics: true });
        const observed = await wave(concurrency, durationMs);
        const server = await stats();
        trials.push({
          ...observed,
          server: {
            requestCount: server.requestCount,
            cpuMs: (server.cpu.user + server.cpu.system) / 1000,
            peakRssMiB: server.peakRss / 1048576,
            maxPoolWaiting: server.maxPoolWaiting,
            dbWaitingSamples: server.dbWaitingSamples,
            dbWaitersMax: server.dbWaitersMax,
            dbSamples: server.samples,
            eventLoopP95Ms: server.eventLoopP95Ms,
            providerCalls: server.calls,
            providerFailures: server.upstreamFailures,
            providerClosed: server.upstreamClosed,
            weatherEvents: server.weatherEvents,
          },
        });
      }
      const cell = { mode, concurrency, trials };
      result.cells.push(cell);
      await writeFile('.cache/transport/load.json', JSON.stringify(result, null, 2));
      console.log(
        JSON.stringify({
          mode,
          concurrency,
          n: trials.reduce((n, t) => n + t.n, 0),
          errors: trials.reduce((n, t) => n + t.errors, 0),
          rps: trials.map((t) => Math.round(t.rps)),
          p95: trials.map((t) => Math.round(t.p95)),
        }),
      );
    }
  }
} finally {
  agent.destroy();
}
