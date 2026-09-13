import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from './app';
import { fixtureService } from './services/meetup';
import type { Assets } from './render';
const production = process.env.NODE_ENV === 'production';
const vite = production
  ? null
  : await (
      await import('vite')
    ).createServer({
      server: { middlewareMode: true, hmr: { port: Number(process.env.PORT ?? 3000) + 10000 } },
      appType: 'custom',
    });
const assets: Assets = {
  scripts: ['/src/app/entry-client.tsx'],
  css: ['/src/features/meetup/meetup.css.ts.vanilla.css?direct'],
};
if (production) {
  const manifest = JSON.parse(await readFile('dist/client/.vite/manifest.json', 'utf8'));
  const entry = manifest['src/app/entry-client.tsx'];
  assets.scripts = ['/' + entry.file];
  assets.css = (entry.css ?? []).map((file: string) => '/' + file);
}
const app = createApp({
  service: fixtureService(process.env.MEETUP_FIXTURE_PATH),
  assets,
  renderer: async () =>
    production
      ? (await import('./render')).renderPage
      : (await vite!.ssrLoadModule('/src/server/render.tsx')).renderPage,
});
if (vite) {
  await app.register((await import('@fastify/middie')).default);
  app.use(vite.middlewares);
} else
  await app.register((await import('@fastify/static')).default, {
    root: resolve('dist/client'),
    prefix: '/',
    index: false,
  });
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) });
console.log(`C'mon Yo! ${production ? 'production' : 'development'} server listening`);
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, async () => {
    await app.close();
    await vite?.close();
    process.exit(0);
  });
