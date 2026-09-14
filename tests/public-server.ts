// Public Web QA entry point. Fixture meetup plus isolated facility data.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import middie from '@fastify/middie';
import staticPlugin from '@fastify/static';
import { createServer } from 'vite';
import { createApp } from '../src/server/app';
import { productionAssets } from '../src/server/assets';
import { databasePlaces } from '../src/server/services/place';
import type { Assets } from '../src/server/render';
import { isolatedPlacesDatabase } from './support/isolated-places';

const port = Number(process.env.QA_PORT ?? 3000);
const production = process.env.QA_PRODUCTION === '1';
const database = await isolatedPlacesDatabase('public_ui');
const vite = production
  ? null
  : await createServer({
      server: { middlewareMode: true, hmr: { port: port + 10000 } },
      appType: 'custom',
    });
const assets: Assets = {
  scripts: ['/src/app/entry-client.tsx'],
  css: ['/src/features/meetup/meetup.css.ts.vanilla.css?direct'],
};
let builtRenderer: string | undefined;
if (production) {
  Object.assign(
    assets,
    productionAssets(JSON.parse(await readFile('dist/client/.vite/manifest.json', 'utf8'))),
  );
  builtRenderer = resolve(
    'dist/server/assets',
    (await readdir('dist/server/assets')).find((name) => /^render-.*\.js$/.test(name))!,
  );
}
const app = createApp({
  assets,
  places: databasePlaces(database.pool, async () => ({ status: 'unavailable', facts: null })),
  renderer: async () =>
    production
      ? (await import(builtRenderer!)).renderPage
      : (await vite!.ssrLoadModule('/src/server/render.tsx')).renderPage,
});
if (vite) {
  await app.register(middie);
  app.use(vite.middlewares);
} else {
  await app.register(staticPlugin, {
    root: resolve('dist/client'),
    prefix: '/',
    index: false,
  });
}
await app.listen({ host: '127.0.0.1', port });
console.log(`Public QA ${production ? 'built assets' : 'development'} server on ${port}`);
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, async () => {
    app.server.closeAllConnections();
    await app.close();
    await vite?.close();
    await database.close();
    process.exit(0);
  });
