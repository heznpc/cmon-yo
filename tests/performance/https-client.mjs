/* global fetch, performance */
import https from 'node:https';
import { createGunzip } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
export const origin = 'https://127.0.0.1:3443';
export const direct = 'http://127.0.0.1:3130';
export const ca = readFileSync(process.env.TRANSPORT_CA);
export const agent = new https.Agent({ ca, keepAlive: true, maxSockets: 128 });
export async function until(fn, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(25);
  }
  throw new Error('Observed condition did not arrive before the test deadline.');
}
export const control = async (body) => {
  const response = await fetch(direct + '/_perf/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw Error('Control failed');
};
export const stats = () => fetch(direct + '/_perf/stats').then((r) => r.json());
export function request(path, { method = 'GET', headers = {}, body, onChunk } = {}) {
  let handle;
  const start = performance.now();
  const promise = new Promise((resolve, reject) => {
    handle = https.request(
      origin + path,
      {
        method,
        agent,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
        timeout: 15000,
      },
      (response) => {
        const firstByteMs = performance.now() - start;
        const authorized = response.socket.authorized;
        const decoded =
          response.headers['content-encoding'] === 'gzip'
            ? response.pipe(createGunzip())
            : response;
        const decoder = new StringDecoder('utf8');
        let text = '',
          bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
        });
        decoded.on('data', (chunk) => {
          text += decoder.write(chunk);
          onChunk?.(text, handle);
        });
        decoded.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text: text + decoder.end(),
            bytes,
            firstByteMs,
            durationMs: performance.now() - start,
            authorized,
          }),
        );
        decoded.on('error', reject);
        response.on('error', reject);
      },
    );
    handle.on('timeout', () => handle.destroy(new Error('HTTPS request deadline')));
    handle.on('error', reject);
    if (body) handle.write(JSON.stringify(body));
    handle.end();
  });
  return { promise, abort: () => handle.destroy(new Error('Test client disconnected')) };
}
export async function signIn(user) {
  const result = await request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: { email: user.email, password: user.password },
  }).promise;
  if (result.status !== 200) throw new Error('Synthetic account sign-in failed: ' + result.status);
  const cookies = result.headers['set-cookie'] ?? [];
  return {
    cookie: cookies.map((x) => x.split(';')[0]).join('; '),
    secure: cookies.every((x) => /; Secure/i.test(x)),
  };
}
