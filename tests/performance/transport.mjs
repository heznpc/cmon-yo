/* global fetch */
import assert from 'node:assert/strict';
import https from 'node:https';
import http2 from 'node:http2';
import { createGunzip } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { writeFile } from 'node:fs/promises';
import {
  ca,
  origin,
  direct,
  agent,
  request,
  until,
  control,
  stats,
  signIn,
} from './https-client.mjs';
const results = [];
const place = 'park-46840-00023';
await until(async () => {
  try {
    return (
      (await fetch(direct + '/_perf/setup')).ok && (await request('/places').promise).status === 200
    );
  } catch {
    return false;
  }
});
const setup = await fetch(direct + '/_perf/setup').then((r) => r.json());
const name = JSON.parse((await request(`/api/v1/places/${place}/info`).promise).text).place.name;
try {
  await assert.rejects(
    new Promise((resolve, reject) => {
      const r = https.get(origin + '/places', { agent: false }, resolve);
      r.on('error', reject);
    }),
    (e) => ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(e.code),
  );
  results.push({ check: 'untrusted local certificate rejected', passed: true });
  for (const encoding of ['identity', 'gzip']) {
    await control({ mode: 'hold', reset: true, weatherDeadlineMs: 60000, metrics: true });
    let body = false,
      ended = false;
    const pending = request('/places/' + place, {
      headers: { 'accept-encoding': encoding },
      onChunk: (text) => {
        body ||= text.includes(name) && text.includes('이 장소의 모임 보기');
      },
    });
    pending.promise
      .then(() => {
        ended = true;
      })
      .catch(() => {});
    await until(() => body);
    assert.equal(ended, false);
    await control({ release: true });
    const result = await pending.promise;
    assert.equal(result.status, 200);
    assert.equal(result.authorized, true);
    assert.ok(result.text.includes('"status":"fresh"'));
    assert.equal(result.headers['cache-control'], 'private, no-store');
    if (encoding === 'gzip') assert.equal(result.headers['content-encoding'], 'gzip');
    results.push({
      check: 'HTTP/1.1 body before held weather',
      encoding,
      passed: true,
      firstByteMs: result.firstByteMs,
    });
  }
  await control({ mode: 'hold', reset: true });
  const h2 = http2.connect(origin, { ca });
  try {
    let body = false,
      ended = false,
      headers;
    const stream = h2.request({ ':path': '/places/' + place, 'accept-encoding': 'gzip' });
    const response = new Promise((resolve, reject) => {
      stream.on('response', (h) => {
        headers = h;
        if (h[':status'] !== 200) {
          reject(new Error('HTTP/2 status ' + h[':status']));
          stream.close();
          return;
        }
        const decoded = h['content-encoding'] === 'gzip' ? stream.pipe(createGunzip()) : stream;
        const decoder = new StringDecoder('utf8');
        let text = '';
        decoded.on('data', (bytes) => {
          text += decoder.write(bytes);
          body ||= text.includes(name) && text.includes('이 장소의 모임 보기');
        });
        decoded.on('end', () => {
          ended = true;
          resolve(text + decoder.end());
        });
        decoded.on('error', reject);
      });
      stream.on('error', reject);
    });
    response.catch(() => {});
    stream.end();
    await until(() => body);
    assert.equal(ended, false);
    assert.equal(h2.socket.alpnProtocol, 'h2');
    assert.equal(h2.socket.authorized, true);
    await control({ release: true });
    assert.ok((await response).includes('"status":"fresh"'));
    assert.equal(headers[':status'], 200);
    results.push({ check: 'HTTP/2 gzip body before held weather', passed: true });
  } finally {
    h2.close();
  }
  await control({ mode: 'hold', reset: true, metrics: true });
  const before = await stats();
  let firstBody = false,
    secondBody = false;
  const first = request('/places/' + place, {
    onChunk: (text) => {
      firstBody ||= text.includes(name);
    },
  });
  const firstOutcome = first.promise.catch(() => null);
  const second = request('/places/' + place, {
    onChunk: (text) => {
      secondBody ||= text.includes(name);
    },
  });
  await until(async () => firstBody && secondBody && (await stats()).weatherEvents.joined >= 1);
  first.abort();
  await firstOutcome;
  await until(async () => (await stats()).cleanups > before.cleanups);
  assert.equal((await stats()).upstreamClosed, 0);
  await control({ release: true });
  assert.ok((await second.promise).text.includes('"status":"fresh"'));
  assert.equal((await stats()).calls, 1);
  results.push({
    check: 'disconnect cleans one renderer while shared consumer succeeds',
    passed: true,
  });
  await control({ mode: 'hold', reset: true, metrics: true });
  let loneBody = false;
  const lone = request('/places/' + place, {
    onChunk: (text) => {
      loneBody ||= text.includes(name);
    },
  });
  const loneOutcome = lone.promise.catch(() => null);
  await until(() => loneBody);
  lone.abort();
  await loneOutcome;
  await until(async () => (await stats()).upstreamClosed === 1);
  results.push({ check: 'last consumer disconnect cancels provider through proxy', passed: true });
  await control({ mode: 'hold', reset: true, weatherDeadlineMs: 250 });
  const timeout = await request('/places/' + place).promise;
  assert.ok(timeout.text.includes(name) && timeout.text.includes('"status":"unavailable"'));
  await control({ release: true, mode: 'normal', reset: true });
  assert.equal((await request('/api/v1/places/' + place + '/weather').promise).status, 200);
  results.push({ check: 'weather timeout preserves body and retry succeeds', passed: true });
  const sessions = await Promise.all(setup.users.map(signIn));
  assert.ok(sessions.every((s) => s.secure && s.cookie));
  for (let i = 0; i < sessions.length; i++) {
    const r = await request('/api/v1/me', { headers: { cookie: sessions[i].cookie } }).promise;
    assert.equal(JSON.parse(r.text).user.id, setup.users[i].id);
    assert.equal(r.headers['cache-control'], 'private, no-store');
    const html = await request('/activity', { headers: { cookie: sessions[i].cookie } }).promise;
    assert.ok(html.text.includes(setup.users[i].name));
    assert.ok(!html.text.includes(setup.users[1 - i].email));
  }
  assert.equal(
    (
      await request('/api/auth/sign-out', {
        method: 'POST',
        headers: { cookie: sessions[0].cookie, origin: 'https://invalid.example' },
        body: {},
      }).promise
    ).status,
    403,
  );
  for (const path of ['/_perf/setup', '/_test/mail'])
    assert.equal((await request(path).promise).status, 404);
  const missing = await request('/places/park-46840-99999').promise;
  assert.equal(missing.status, 404);
  const doc = await request('/community').promise;
  const asset = doc.text.match(/\/assets\/entry-client-[^"\s]+\.js/)?.[0];
  assert.ok(asset);
  const js = await request(asset).promise;
  assert.match(js.headers['cache-control'], /max-age=31536000.*immutable/);
  results.push({
    check:
      'Secure cookie, two identities, Origin, private cache, asset cache, 404, hidden control routes',
    passed: true,
  });
  await writeFile(
    '.cache/transport/transport.json',
    JSON.stringify(
      {
        startedOn: new Date().toISOString(),
        scope:
          'Local Caddy TLS; explicit test CA only; no system trust-store change; no public deployment',
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks: results.length, passed: true }));
} finally {
  await control({ release: true, releaseViewers: true, mode: 'normal' }).catch(() => {});
  agent.destroy();
}
