import { databaseAttendance } from '../src/server/services/attendance';
import { evaluatePosition } from '../src/contracts/attendance';
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import { createPool, migrate } from '../src/server/db';
import { createAuth } from '../src/server/auth/service';
import { databaseMeetings, migrateMeetings } from '../src/server/services/meetings';
import { databaseCommunity } from '../src/server/services/community';
import { createApp } from '../src/server/app';
import { renderPage } from '../src/server/render';
import type { AuthMail } from '../src/server/auth/mail';
import type pg from 'pg';
describe.runIf(process.env.TEST_DATABASE_URL)('community HTTP and SSR with real PostgreSQL', () => {
  const schema = 'community_' + randomUUID().replaceAll('-', '');
  const configured = 'http://127.0.0.1:3189';
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
    app = createApp({
      auth,
      community: databaseCommunity(pool),
      attendance: databaseAttendance(pool),
      meetings: databaseMeetings(pool),
      renderer: async () => renderPage,
    });
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

  const input = {
    title: '[시험] 운동 질문',
    body: '<script>alert(1)</script> & 안전한 본문',
    sport: 'walking',
    regionCode: '46840',
  };
  const command = (body: unknown, who = users[0], key = randomUUID(), extra = {}) =>
    call('/api/v1/community/commands', 'POST', body, who, key, extra);
  test('posts, comments, authorization, version, replay, reporting, blocking and SSR isolation', async () => {
    const key = randomUUID(),
      payload = { action: 'create', input };
    const responses = await Promise.all([
      command(payload, users[0], key),
      command(payload, users[0], key),
    ]);
    for (const r of responses) expect(r.status, await r.clone().text()).toBe(200);
    const { id } = await responses[0].json();
    expect(await responses[1].json()).toEqual({ id });
    expect(
      (await command({ ...payload, input: { ...input, title: '다른 내용' } }, users[0], key))
        .status,
    ).toBe(409);
    expect(
      (await command({ action: 'edit', id, expectedVersion: 1, input }, users[1])).status,
    ).toBe(403);
    expect(
      (
        await command({
          action: 'edit',
          id,
          expectedVersion: 1,
          input: { ...input, title: '수정' },
        })
      ).status,
    ).toBe(200);
    expect((await command({ action: 'delete', id, expectedVersion: 1 })).status).toBe(409);
    const c = await command({ action: 'comment', parent: 'post', id, body: '질문 댓글' }, users[1]);
    expect(c.status).toBe(200);
    const commentId = (await c.json()).id;
    const commentList = await (await call(`/api/v1/posts/${id}/comments`)).json();
    expect(commentList.comments).toHaveLength(1);
    expect(
      (await command({ action: 'deleteComment', id: commentId, expectedVersion: 1 }, users[0]))
        .status,
    ).toBe(403);
    const report = await command(
      { action: 'report', target: 'post', id, reason: '시험 신고' },
      users[1],
    );
    expect(report.status).toBe(200);
    expect(
      (await command({ action: 'block', id: users[0].id, blocked: true }, users[1])).status,
    ).toBe(200);
    expect((await call(`/api/v1/posts/${id}`, 'GET', undefined, users[1])).status).toBe(404);
    expect((await call(`/api/v1/posts/${id}/comments`, 'GET', undefined, users[1])).status).toBe(
      404,
    );
    expect((await call(`/community/${id}`, 'GET', undefined, users[1])).status).toBe(404);
    const publicPage = await call(`/community/${id}`);
    expect(publicPage.status).toBe(200);
    const html = await publicPage.text();
    expect(html).toContain('수정');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect((await call('/api/v1/posts?mine=1')).status).toBe(401);
    expect(
      (await command({ action: 'block', id: users[0].id, blocked: false }, users[1])).status,
    ).toBe(200);
    expect((await call(`/api/v1/posts/${id}`, 'GET', undefined, users[1])).status).toBe(200);
    expect(
      (await command(payload, users[0], randomUUID(), { 'X-Cmon-User': users[1].id })).status,
    ).toBe(409);
    expect(
      (await command(payload, users[0], randomUUID(), { Cookie: 'untrusted=value' })).status,
    ).toBe(403);
    await databaseCommunity(pool).moderate((await report.json()).id, 'hidden');
    expect((await call(`/api/v1/posts/${id}`)).status).toBe(404);
    expect(
      (await command({ action: 'comment', parent: 'post', id, body: '삭제된 부모' })).status,
    ).toBe(404);
    expect(
      (await call('/api/v1/me/community-commands/' + key, 'GET', undefined, users[0])).headers.get(
        'cache-control',
      ),
    ).toBe('private, no-store');
  });
  test('attendance permissions, review versus confirmation, location boundaries and replay', async () => {
    const host = users[0],
      guest = users[1],
      service = databaseAttendance(pool);
    const m = await databaseMeetings(pool).command(host.id, randomUUID(), {
      title: '[시험] 현장 확인',
      description: '',
      sport: 'walking',
      placeId,
      startsAt: new Date(Date.now() + 60000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      capacity: 3,
    });
    await databaseMeetings(pool).command(
      guest.id,
      randomUUID(),
      { action: 'join', expectedVersion: 1 },
      m.id,
    );
    const payload = { action: 'requestReview', reason: '위치 권한 거부' };
    const result = await call(
      `/api/v1/meetups/${m.id}/attendance`,
      'POST',
      payload,
      guest,
      randomUUID(),
    );
    expect(result.status, await result.clone().text()).toBe(200);
    const current = await service.detail(guest.id, m.id);
    expect(current.state.review).toBe('pending');
    expect(current.state.status).toBe('pending');
    expect(current.requests).toEqual([]);
    const expired = await databaseAttendance(pool, () => Date.now() + 8 * 86400000).detail(
      guest.id,
      m.id,
    );
    expect(expired.state).toMatchObject({ status: 'attendance_unverified', review: 'expired' });
    const self = await call(
      `/api/v1/meetups/${m.id}/attendance`,
      'POST',
      { action: 'review', userId: guest.id, decision: 'approved' },
      guest,
      randomUUID(),
    );
    expect(self.status).toBe(403);
    const key = randomUUID();
    const confirm = { action: 'review' as const, userId: guest.id, decision: 'approved' as const };
    expect(await service.command(host.id, key, m.id, confirm)).toEqual({ id: m.id });
    expect(await service.command(host.id, key, m.id, confirm)).toEqual({ id: m.id });
    expect((await service.detail(guest.id, m.id)).state).toMatchObject({
      status: 'checked_in',
      method: 'host',
      review: 'approved',
    });
    const point = {
      latitude: 34.80642405,
      longitude: 126.4842218,
      accuracy: 20,
      capturedAt: Date.now(),
    };
    expect(evaluatePosition(point, point, Date.now(), Date.now() + 60000, Date.now())).toBeNull();
    expect(
      evaluatePosition(
        { ...point, accuracy: 101 },
        point,
        Date.now(),
        Date.now() + 60000,
        Date.now(),
      ),
    ).toBe('INACCURATE_POSITION');
    expect(
      evaluatePosition(
        { ...point, capturedAt: 0 },
        point,
        Date.now(),
        Date.now() + 60000,
        Date.now(),
      ),
    ).toBe('STALE_POSITION');
    expect(
      evaluatePosition(
        { ...point, latitude: 35 },
        point,
        Date.now(),
        Date.now() + 60000,
        Date.now(),
      ),
    ).toBe('OUTSIDE_PLACE');
    const gps = await call(
      `/api/v1/meetups/${m.id}/attendance`,
      'POST',
      { action: 'checkIn', position: point },
      host,
      randomUUID(),
    );
    expect(gps.status, await gps.clone().text()).toBe(200);
    const stored = JSON.stringify(
      (await pool.query('SELECT * FROM attendance WHERE meetup_id=$1', [m.id])).rows,
    );
    expect(stored).not.toContain('latitude');
    expect(stored).not.toContain('34.806');
    await databaseMeetings(pool).command(
      host.id,
      randomUUID(),
      { action: 'cancel', expectedVersion: 2 },
      m.id,
    );
    expect((await service.detail(guest.id, m.id)).state.status).toBeNull();
    expect(
      (await call(`/api/v1/meetups/${m.id}/attendance`, 'POST', payload, guest, randomUUID()))
        .status,
    ).toBe(409);
  });
  test('cursor pages tolerate concurrent insertion/deletion and profile writes keep ownership/version', async () => {
    const service = databaseCommunity(pool),
      who = users[0];
    await pool.query(
      "INSERT INTO posts(id,author_id,title,body,sport,region_code,created_at) SELECT gen_random_uuid(),$1,'[시험] 페이지 '||g,'본문','cycling','46840',now()-g*interval '1 second' FROM generate_series(1,25) g",
      [who.id],
    );
    const first = await service.list(who.id, { sport: 'cycling', page: 0 });
    expect(first.posts).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();
    await pool.query(
      "INSERT INTO posts(id,author_id,title,body,sport,region_code) VALUES($1,$2,'새 글','본문','cycling','46840')",
      [randomUUID(), who.id],
    );
    await pool.query('UPDATE posts SET hidden=true WHERE id=$1', [first.posts[0].id]);
    const second = await service.list(who.id, {
      sport: 'cycling',
      page: 0,
      cursor: first.nextCursor!,
    });
    expect(second.posts).toHaveLength(5);
    expect(second.posts.some((p) => first.posts.some((f) => f.id === p.id))).toBe(false);
    const before = await service.profile(who.id),
      key = randomUUID();
    const input = {
      action: 'profile' as const,
      name: '새 닉네임',
      regionCode: '46840' as const,
      expectedVersion: before.version,
    };
    expect(await service.command(who.id, key, input)).toEqual({ id: who.id });
    expect(await service.command(who.id, key, input)).toEqual({ id: who.id });
    expect((await service.profile(who.id)).name).toBe('새 닉네임');
    await expect(service.command(who.id, randomUUID(), input)).rejects.toMatchObject({
      status: 409,
    });
    const wrong = await call('/api/v1/posts?mine=1', 'GET', undefined, users[1], undefined, {
      'X-Cmon-User': who.id,
    });
    expect(wrong.status).toBe(409);
    const html = await call('/activity', 'GET', undefined, who);
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('새 닉네임');
  });
  test('write limit serializes concurrent writes per account', async () => {
    const who = users[2];
    const replies = await Promise.all(
      Array.from({ length: 23 }, () => command({ action: 'create', input }, who)),
    );
    expect(replies.filter((r) => r.status === 200)).toHaveLength(20);
    expect(replies.filter((r) => r.status === 429)).toHaveLength(3);
  });
});
