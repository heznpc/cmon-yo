import { readFile, writeFile } from 'node:fs/promises';
const labels = process.argv.slice(2);
if (labels.length !== 2) throw Error('Pass before and after measurement labels.');
const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] * 10) / 10
    : null;
};
const distribution = (values) => ({
  n: values.filter(Number.isFinite).length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
});
const summarize = (d) => ({
  environment: d.environment,
  errors: d.errors,
  documents: Object.fromEntries(
    ['normal', 'delay', 'failure', 'timeout', 'hit'].map((mode) => {
      const rows = d.documents.filter((r) => r.mode === mode);
      return [
        mode,
        Object.fromEntries(
          [
            'ttfb',
            'body',
            'lcp',
            'usable',
            'hydration',
            'html',
            'api',
            'requests',
            'bytes',
            'providerCalls',
            'providerFailures',
            'providerClosed',
          ].map((k) => [k, distribution(rows.map((r) => r[k]))]),
        ),
      ];
    }),
  ),
  journeys: Object.fromEntries(
    ['anonymous', 'signed-in', 'switch'].map((identity) => {
      const rows = d.journeys.filter((r) => r.identity === identity);
      return [
        identity,
        {
          steps: Object.fromEntries(
            [...new Set(rows.flatMap((r) => r.steps.map((s) => s.name)))].map((name) => [
              name,
              distribution(
                rows.flatMap((r) => r.steps.filter((s) => s.name === name).map((s) => s.ms)),
              ),
            ]),
          ),
          network: Object.fromEntries(
            ['html', 'api', 'requests', 'bytes', 'abandoned'].map((k) => [
              k,
              distribution(rows.map((r) => r[k] ?? 0)),
            ]),
          ),
        },
      ];
    }),
  ),
  concurrency: d.concurrency.map((c) => {
    const requests = c.runs.flatMap((r) => r.requests),
      servers = c.runs.map((r) => r.server);
    return {
      mode: c.mode,
      concurrency: c.concurrency,
      latency: distribution(requests.map((r) => r.ms)),
      errors: requests.filter((r) => r.status !== 200).length,
      providerCalls: distribution(servers.map((s) => s.calls)),
      providerFailures: distribution(servers.map((s) => s.upstreamFailures)),
      cpuMs: distribution(servers.map((s) => (s.cpu.user + s.cpu.system) / 1000)),
      peakRssMiB: Math.round((Math.max(...servers.map((s) => s.peakRss)) / 1048576) * 10) / 10,
      maxPoolWaiting: Math.max(...servers.map((s) => s.maxPoolWaiting)),
      dbWaitersMax: Math.max(...servers.map((s) => s.dbWaitersMax)),
      dbWaitingSamples: servers.reduce((n, s) => n + s.dbWaitingSamples, 0),
      dbSamples: servers.reduce((n, s) => n + s.samples, 0),
      weatherEvents: servers.map((s) => s.weatherEvents ?? null),
    };
  }),
});
const data = Object.fromEntries(
  await Promise.all(
    labels.map(async (label) => [
      label,
      summarize(JSON.parse(await readFile(`.cache/performance/${label}.json`, 'utf8'))),
    ]),
  ),
);
await writeFile('.cache/performance/comparison.json', JSON.stringify(data, null, 2));
console.log(JSON.stringify(data, null, 2));
