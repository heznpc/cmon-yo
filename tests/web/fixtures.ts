import { test as base } from '@playwright/test';
export { expect, type Page, type APIRequestContext, type BrowserContext } from '@playwright/test';

// Regression tests exercise our pins and recovery without sending automated
// tile traffic to a public map service. Real map rendering is checked separately.
export const test = base.extend<{ mapTiles: void }>({
  mapTiles: [
    async ({ context }, use) => {
      await context.route('https://tiles.openfreemap.org/**', (route) =>
        route.fulfill({
          contentType: 'application/json',
          json: {
            version: 8,
            sources: {
              test: {
                type: 'geojson',
                data: {
                  type: 'FeatureCollection',
                  features: [
                    {
                      type: 'Feature',
                      properties: {},
                      geometry: { type: 'Point', coordinates: [126.45, 34.9] },
                    },
                  ],
                },
              },
            },
            layers: [
              {
                id: 'test-background',
                type: 'background',
                paint: { 'background-color': '#e7ebe4' },
              },
              {
                id: 'test-worker-source',
                type: 'circle',
                source: 'test',
                paint: { 'circle-radius': 4 },
              },
            ],
          },
        }),
      );
      await use();
    },
    { auto: true },
  ],
});
