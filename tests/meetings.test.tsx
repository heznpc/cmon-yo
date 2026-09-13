import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import { createPool, migrate } from '../src/server/db';
import { createAuth } from '../src/server/auth/service';
import { databaseMeetings, migrateMeetings } from '../src/server/services/meetings';
import { createApp } from '../src/server/app';
import { renderPage } from '../src/server/render';
import {
  meetingDetailSchema,
  meetingInputSchema,
  myMeetingsSchema,
} from '../src/contracts/meetings';
import type { AuthMail } from '../src/server/auth/mail';
import type pg from 'pg';
import { Ajv2020 } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

test('meeting inputs reject impossible time order, unknown fields and invalid capacities', () => {
  const base = {
    title: '걷기',
    description: '',
    sport: 'walking',
    placeId: 'park-46840-00001',
    startsAt: '2027-01-01T00:00:00.000Z',
    endsAt: '2027-01-01T01:00:00.000Z',
    capacity: 2,
  };
  expect(meetingInputSchema.safeParse(base).success).toBe(true);
  for (const input of [
    { ...base, capacity: 1 },
    { ...base, endsAt: base.startsAt },
    { ...base, title: ' ' },
    { ...base, hostId: randomUUID() },
  ])
    expect(meetingInputSchema.safeParse(input).success).toBe(false);
});
describe.runIf(process.env.TEST_DATABASE_URL)(
  'real meetup and Native account HTTP/DB lifecycle',
  () => {
    const schema = 'meetings_' + randomUUID().replaceAll('-', '');
    const configured = 'http://127.0.0.1:3188';
    const mail: AuthMail[] = [];
    let admin: pg.Pool;
    let pool: pg.Pool;
    let app: ReturnType<typeof createApp>;
    let origin: string;
    let placeId: string;
    type Identity = { id: string; email: string; password: string; token: string; cookie: string };
    const users: Identity[] = [];
    const call = (
      path: string,
      method = 'GET',
      payload?: unknown,
      who?: Identity,
      key?: string,
      extra: Record<string, string> = {},
    ) =>
      fetch(origin + path, {
        method,
        redirect: 'manual',
        headers: {
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...(who ? { Authorization: `Bearer ${who.token}`, 'X-Cmon-User': who.id } : {}),
          ...(key ? { 'Idempotency-Key': key } : {}),
          ...extra,
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });
    beforeAll(async () => {
      admin = createPool(process.env.TEST_DATABASE_URL!);
      await admin.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(process.env.TEST_DATABASE_URL!);
      url.searchParams.set('options', `-c search_path=${schema}`);
      pool = createPool(url.href);
      const auth = createAuth({
        pool,
        origin: configured,
        secret: randomBytes(32).toString('hex'),
        sendMail: async (m) => {
          mail.push(m);
        },
      });
      await (await getMigrations(auth.options)).runMigrations();
      await migrate(pool);
      await migrateMeetings(pool);
      const fixture = JSON.parse(await readFile('contracts/fixtures/place.json', 'utf8'));
      const place = fixture.place;
      placeId = place.id;
      await pool.query('INSERT INTO places (source,source_key,document) VALUES ($1,$2,$3)', [
        'data.go.kr/15012890',
        place.id.replace('park-', ''),
        place,
      ]);
      app = createApp({ auth, meetings: databaseMeetings(pool), renderer: async () => renderPage });
      origin = await app.listen({ host: '127.0.0.1', port: 0 });
      for (const label of ['주최 시험', '참여 시험 가', '참여 시험 나']) {
        const email = `native-${randomUUID()}@example.test`,
          password = 'Local-Only-' + randomUUID();
        expect(
          (
            await call('/api/native/auth/sign-up/email', 'POST', {
              email,
              password,
              name: label,
              callbackURL: '/account',
            })
          ).status,
        ).toBe(200);
        const url = new URL(mail.find((m) => m.to === email)!.url);
        expect((await call(url.pathname + url.search)).status).toBe(302);
        const login = await call('/api/native/auth/sign-in/email', 'POST', { email, password });
        expect(login.status, await login.clone().text()).toBe(200);
        expect(login.headers.getSetCookie()).toHaveLength(0);
        const { token } = await login.json();
        expect(token).toContain('.');
        const me = await (
          await call('/api/v1/me', 'GET', undefined, undefined, undefined, {
            Authorization: `Bearer ${token}`,
          })
        ).json();
        users.push({ email, password, token, id: me.user.id, cookie: '' });
      }
    }, 60_000);
    afterAll(async () => {
      await app?.close();
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });
    const input = () => ({
      title: '[시험] 실제 DB 운동 약속',
      description: '<script>텍스트로만 표시</script>',
      sport: 'walking',
      placeId,
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
      capacity: 2,
    });
    const get = async (id: string) =>
      meetingDetailSchema.parse(await (await call(`/api/v1/meetups/${id}`)).json()).meetup;
    test('idempotent create, final-seat race, stale intents, edit/cancel permissions, lost responses and personal SSR', async () => {
      const draft = input();
      const key = randomUUID();
      const attempts = await Promise.all([
        call('/api/v1/meetups', 'POST', draft, users[0], key),
        call('/api/v1/meetups', 'POST', draft, users[0], key),
      ]);
      expect(attempts.map((r) => r.status)).toEqual([200, 200]);
      const { id } = await attempts[0].json();
      expect(await attempts[1].json()).toEqual({ id });
      expect(
        (await call('/api/v1/meetups', 'POST', { ...draft, title: '다른 입력' }, users[0], key))
          .status,
      ).toBe(409);
      const m = await get(id);
      expect(m.participantCount).toBe(1);
      expect((await call(`/api/v1/me/commands/${key}`, 'GET', undefined, users[1])).status).toBe(
        200,
      );
      expect(
        await (await call(`/api/v1/me/commands/${key}`, 'GET', undefined, users[1])).json(),
      ).toEqual({ id: null });
      const join = { action: 'join', expectedVersion: m.version };
      const race = await Promise.all(
        users.slice(1).map((u) => call(`/api/v1/meetups/${id}`, 'PATCH', join, u, randomUUID())),
      );
      expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = users[race[0].status === 200 ? 1 : 2],
        loser = users[race[0].status === 200 ? 2 : 1];
      const full = await get(id);
      expect(full.participantCount).toBe(2);
      expect(
        (
          await call(
            `/api/v1/meetups/${id}`,
            'PATCH',
            { ...join, expectedVersion: full.version },
            loser,
            randomUUID(),
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await call(
            `/api/v1/meetups/${id}`,
            'PATCH',
            { action: 'cancel', expectedVersion: full.version },
            winner,
            randomUUID(),
          )
        ).status,
      ).toBe(403);
      const cancelKey = randomUUID();
      // Drop the response body after the server committed, then query by command.
      const leave = await call(
        `/api/v1/meetups/${id}`,
        'PATCH',
        { action: 'leave', expectedVersion: full.version },
        winner,
        cancelKey,
      );
      expect(leave.status).toBe(200);
      await leave.body?.cancel();
      expect(
        await (await call(`/api/v1/me/commands/${cancelKey}`, 'GET', undefined, winner)).json(),
      ).toEqual({ id });
      expect((await get(id)).participantCount).toBe(1);
      expect(
        (await call(`/api/v1/meetups/${id}`, 'PATCH', join, winner, randomUUID())).status,
      ).toBe(409);
      const mine = myMeetingsSchema.parse(
        await (await call('/api/v1/me/meetups', 'GET', undefined, winner)).json(),
      );
      expect(mine.meetups[0].participationStatus).toBe('cancelled');
      const changed = await get(id);
      expect(
        (
          await call(
            `/api/v1/meetups/${id}`,
            'PATCH',
            {
              action: 'edit',
              expectedVersion: changed.version,
              input: { ...draft, title: '[시험] 일정 수정' },
            },
            users[0],
            randomUUID(),
          )
        ).status,
      ).toBe(200);
      const pages = await Promise.all(
        [users[0], loser].map((u) =>
          call('/account/meetups', 'GET', undefined, u).then((r) => r.text()),
        ),
      );
      expect(pages[0]).toContain('[시험] 일정 수정');
      expect(pages[1]).not.toContain('[시험] 일정 수정');
      expect(pages[0]).not.toContain(users[0].token);
      const update = await get(id);
      expect(
        (
          await call(
            `/api/v1/meetups/${id}`,
            'PATCH',
            { action: 'cancel', expectedVersion: update.version },
            users[0],
            randomUUID(),
          )
        ).status,
      ).toBe(200);
      expect((await get(id)).status).toBe('cancelled');
      expect(
        (
          await call(
            `/api/v1/meetups/${id}`,
            'PATCH',
            { action: 'join', expectedVersion: update.version + 1 },
            loser,
            randomUUID(),
          )
        ).status,
      ).toBe(409);
      const document = await (await call('/api/v1/openapi.json')).json();
      const ajv = new Ajv2020({ strict: false });
      addFormats(ajv);
      const validate = ajv.compile(
        document.paths['/api/v1/meetups/{id}'].get.responses['200'].content['application/json']
          .schema,
      );
      expect(
        validate(await (await call(`/api/v1/meetups/${id}`)).json()),
        JSON.stringify(validate.errors),
      ).toBe(true);
      expect((await call('/api/v1/meetups?regionCode=other')).status).toBe(400);
      expect((await call('/api/v1/meetups?date=2026-02-31')).status).toBe(400);
      expect(
        (
          await call('/api/v1/meetups', 'POST', draft, users[0], randomUUID(), {
            'X-Cmon-User': users[1].id,
          })
        ).status,
      ).toBe(409);
    }, 30_000);
    test('native credentials cannot fall back to cookies, browser token leaks are blocked, expiry and deletion revoke access', async () => {
      const u = users[0];
      expect(
        (
          await call(
            '/api/native/auth/sign-in/email',
            'POST',
            { email: u.email, password: u.password },
            undefined,
            undefined,
            { Origin: configured },
          )
        ).status,
      ).toBe(403);
      let login = await call(
        '/api/auth/sign-in/email',
        'POST',
        { email: u.email, password: u.password },
        undefined,
        undefined,
        { Origin: configured },
      );
      if (login.status === 429) {
        await new Promise((r) =>
          setTimeout(r, (Number(login.headers.get('retry-after')) + 1) * 1000),
        );
        login = await call(
          '/api/auth/sign-in/email',
          'POST',
          { email: u.email, password: u.password },
          undefined,
          undefined,
          { Origin: configured },
        );
      }
      expect(login.status, await login.clone().text()).toBe(200);
      expect(login.headers.get('set-auth-token')).toBeNull();
      expect(await login.text()).not.toContain('"token"');
      const cookie = login.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      expect(
        (
          await call('/api/v1/me', 'GET', undefined, undefined, undefined, {
            Cookie: cookie,
            Authorization: 'Bearer forged',
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await call('/api/v1/meetups', 'POST', input(), u, randomUUID(), {
            Cookie: cookie,
            Origin: 'https://untrusted.invalid',
          })
        ).status,
      ).toBe(403);
      const created = await (
        await call('/api/v1/meetups', 'POST', input(), u, randomUUID())
      ).json();
      await pool.query('DELETE FROM auth_user WHERE id=$1', [u.id]);
      expect((await get(created.id)).status).toBe('cancelled');
      expect((await call('/api/v1/me', 'GET', undefined, u)).status).toBe(401);
      await pool.query(
        'UPDATE auth_session SET "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE "userId"=$1',
        [users[1].id],
      );
      expect((await call('/api/v1/me', 'GET', undefined, users[1])).status).toBe(401);
      expect((await call('/api/native/auth/sign-out', 'POST', {}, users[2])).status).toBe(200);
      expect((await call('/api/v1/me', 'GET', undefined, users[2])).status).toBe(401);
    }, 30_000);
  },
);
