import { expect, test } from 'vitest';
import { createApp } from '../src/server/app';
import { proxyTrust } from '../src/server/proxy';
import { renderPage } from '../src/server/render';

test('proxy trust is explicit and forwarded identity is accepted only from configured peers', async () => {
  expect(proxyTrust(undefined)).toBe(false);
  for (const value of ['true', '1', '0.0.0.0/0']) expect(() => proxyTrust(value)).toThrow();
  for (const enabled of [false, true]) {
    const app = createApp({
      renderer: async () => renderPage,
      trustProxy: proxyTrust(enabled ? 'loopback' : undefined),
    });
    app.get('/_test/peer', async (r) => ({ ip: r.ip, protocol: r.protocol }));
    try {
      for (const peer of ['127.0.0.1', '198.51.100.10']) {
        const response = await app.inject({
          url: '/_test/peer',
          remoteAddress: peer,
          headers: { 'x-forwarded-for': '192.0.2.10', 'x-forwarded-proto': 'https' },
        });
        const trusted = enabled && peer === '127.0.0.1';
        expect(response.json()).toEqual({
          ip: trusted ? '192.0.2.10' : peer,
          protocol: trusted ? 'https' : 'http',
        });
      }
    } finally {
      await app.close();
    }
  }
});
