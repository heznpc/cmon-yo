import { beforeAll, beforeEach, afterAll, describe, expect, test } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { getMigrations } from 'better-auth/db/migration';
import type pg from 'pg';
import { createPool } from '../src/server/db';
import { createAuth } from '../src/server/auth/service';
import { createApp } from '../src/server/app';
import { renderPage } from '../src/server/render';
import { migrateWalking } from '../src/server/migrations';
import { databaseWalking } from '../src/server/walking/service';
import { canonicalCommand, dailyPoints, seoulDay, shiftDay } from '../src/server/walking/policy';
import { walkingDashboardSchema, type WalkingCommand } from '../src/contracts/walking';
import { commandResultSchema } from '../src/contracts/command';
import { responseContract } from './helpers/openapi';

test('walking day boundaries use Seoul midnight and capped whole milestones', () => {
  expect(seoulDay(Date.parse('2026-09-22T14:59:59Z'))).toBe('2026-09-22');
  expect(seoulDay(Date.parse('2026-09-22T15:00:00Z'))).toBe('2026-09-23');
  expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  expect(dailyPoints(999)).toBe(0);
  expect(dailyPoints(1999)).toBe(1);
  expect(dailyPoints(100000)).toBe(10);
  expect(() => canonicalCommand({ action: 'syncHealth', sourceId: randomUUID(), revision: 1, days: [{ day: '2026-09-22', steps: 1 }, { day: '2026-09-22', steps: 2 }] })).toThrow();
});

// These database scenarios are authored for a later explicitly permitted run.
describe.runIf(process.env.TEST_DATABASE_URL)('walking rewards with isolated PostgreSQL', () => {
  const schema = 'walking_' + randomUUID().replaceAll('-', '');
  let admin: pg.Pool, pool: pg.Pool;
  let clock: number;
  let walking: ReturnType<typeof databaseWalking>;
  let app: ReturnType<typeof createApp>, origin: string;
  const configured = 'http://127.0.0.1:3189';
  const send = (user: string, input: WalkingCommand, key = randomUUID()) => walking.command(user, key, input);
  const identity = async (name = '산책 시험') => {
    const id = randomUUID();
    await pool.query('INSERT INTO auth_user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())', [id, name, `${id}@example.test`]);
    return id;
  };
  const bind = async (user: string, deviceId = randomUUID()) => ({ ...(await send(user, { action: 'bindHealth', deviceId })), deviceId });
  const sync = (user: string, sourceId: string, revision: number, steps: number, day = seoulDay(clock)) => send(user, { action: 'syncHealth', sourceId, revision, days: [{ day, steps }] });
  const expedition = async (user: string) => {
    const created = await send(user, { action: 'createExpedition', title: '함께 걷는 7일', placeId: null });
    return (await walking.dashboard(user)).expeditions.find((entry) => entry.id === created.id)!;
  };
  beforeAll(async () => {
    admin = createPool(process.env.TEST_DATABASE_URL!);
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = createPool(url.href);
    const auth = createAuth({ pool, origin: configured, secret: randomBytes(32).toString('hex'), sendMail: async () => {} });
    await (await getMigrations(auth.options)).runMigrations();
    await migrateWalking(pool);
    walking = databaseWalking(pool, () => clock);
    app = createApp({ auth, walking, renderer: async () => renderPage });
    origin = await app.listen({ host: '127.0.0.1', port: 0 });
  }, 60_000);
  beforeEach(() => { clock = Date.parse('2026-09-22T14:00:00Z'); });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  test('actual corrections preserve credited progress and only newly crossed daily milestones earn', async () => {
    const user = await identity(), source = await bind(user);
    await sync(user, source.id, 1, 1500);
    const key = randomUUID(), claim: WalkingCommand = { action: 'claimDaily', day: '2026-09-22' };
    const results = await Promise.all([send(user, claim, key), send(user, claim, key)]);
    expect(results[0]).toEqual(results[1]);
    await sync(user, source.id, 2, 3900);
    const syncedAt = (await walking.dashboard(user)).days[0].updatedAt;
    clock += 60000;
    await send(user, claim);
    expect((await walking.dashboard(user)).days[0].updatedAt).toBe(syncedAt);
    await sync(user, source.id, 3, 500);
    await send(user, claim);
    let dashboard = walkingDashboardSchema.parse(await walking.dashboard(user));
    expect(dashboard.days[0]).toMatchObject({ steps: 500, creditedSteps: 3900, claimedPoints: 3, availablePoints: 0 });
    expect(dashboard.balance).toBe(3);
    expect(dashboard.ledger).toHaveLength(3);
    await sync(user, source.id, 4, 100000);
    await send(user, claim);
    dashboard = await walking.dashboard(user);
    expect(dashboard.balance).toBe(10);
    expect(dashboard.days[0].creditedSteps).toBe(10000);
    expect(await walking.result(user, key)).toEqual(results[0]);
    await expect(send(user, { action: 'claimDaily', day: '2026-09-21' }, key)).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
  });

  test('source revision, account binding, date range and device rotation reject stale writes', async () => {
    const user = await identity(), other = await identity(), source = await bind(user);
    expect(await bind(user, source.deviceId)).toEqual(source);
    await expect(bind(other, source.deviceId)).rejects.toMatchObject({ code: 'DEVICE_BOUND' });
    await sync(user, source.id, 2, 3000);
    expect((await walking.dashboard(user)).sourceRevision).toBe(2);
    await sync(user.toUpperCase(), source.id.toUpperCase(), 2, 3000);
    await expect(sync(user, source.id, 2, 4000)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(sync(user, source.id, 1, 4000)).rejects.toMatchObject({ code: 'STALE_REVISION' });
    await expect(sync(user, source.id, 3, 4000, '2026-09-23')).rejects.toMatchObject({ code: 'DAY_OUT_OF_RANGE' });
    await expect(sync(user, source.id, 3, 4000, '2026-09-14')).rejects.toMatchObject({ code: 'DAY_OUT_OF_RANGE' });
    const replacement = await bind(user);
    await expect(sync(user, source.id, 3, 9000)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    await sync(user, replacement.id, 1, 2000);
    expect((await walking.dashboard(user)).days[0]).toMatchObject({ steps: 2000, creditedSteps: 3000 });
    await sync(user, replacement.id, 2, 4000);
    expect((await walking.dashboard(user)).days[0].creditedSteps).toBe(4000);
  });

  test('five-member capacity, overlapping participation and frozen membership serialize races', async () => {
    const owner = await identity(), party = await expedition(owner);
    expect(party).toMatchObject({ startsOn: '2026-09-23', endsOn: '2026-09-30', state: 'recruiting' });
    const joiners = await Promise.all(Array.from({ length: 6 }, () => identity()));
    const results = await Promise.allSettled(joiners.map((user) => send(user, { action: 'joinExpedition', code: party.inviteCode! })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2);
    const joined = joiners[results.findIndex((result) => result.status === 'fulfilled')];
    await expect(expedition(joined)).rejects.toMatchObject({ code: 'EXPEDITION_OVERLAP' });
    await send(joined, { action: 'leaveExpedition', expeditionId: party.id });
    await send(joined, { action: 'joinExpedition', code: party.inviteCode! });
    clock = Date.parse('2026-09-22T15:00:00Z');
    const newcomer = await identity();
    await expect(send(newcomer, { action: 'joinExpedition', code: party.inviteCode! })).rejects.toMatchObject({ code: 'RECRUITMENT_CLOSED' });
    await send(joined, { action: 'leaveExpedition', expeditionId: party.id });
    await expect(send(joined, { action: 'joinExpedition', code: party.inviteCode! })).rejects.toMatchObject({ code: 'EXPEDITION_WITHDRAWN' });
  });

  test('campaign date limits, distinct contribution gates and withdrawal snapshots preserve shared progress', async () => {
    const owner = await identity(), peer = await identity(), party = await expedition(owner);
    await send(peer, { action: 'joinExpedition', code: party.inviteCode! });
    const a = await bind(owner), b = await bind(peer);
    await sync(owner, a.id, 1, 10000);
    expect((await walking.dashboard(owner)).expeditions[0].steps).toBe(0);
    clock = Date.parse('2026-09-23T03:00:00Z');
    await sync(owner, a.id, 2, 10000);
    await expect(send(owner, { action: 'claimStage', expeditionId: party.id, stage: 0 })).rejects.toMatchObject({ code: 'STAGE_LOCKED' });
    await sync(peer, b.id, 1, 999);
    await expect(send(peer, { action: 'claimStage', expeditionId: party.id, stage: 0 })).rejects.toMatchObject({ code: 'STAGE_LOCKED' });
    await sync(peer, b.id, 2, 1000);
    const claims = await Promise.all([0, 1].map(() => send(owner, { action: 'claimStage', expeditionId: party.id, stage: 0 })));
    expect(claims[0]).toEqual(claims[1]);
    await send(peer, { action: 'claimStage', expeditionId: party.id, stage: 0 });
    expect((await walking.dashboard(owner)).balance).toBe(5);
    expect((await walking.dashboard(peer)).balance).toBe(5);
    await send(owner, { action: 'leaveExpedition', expeditionId: party.id });
    await sync(owner, a.id, 3, 10000, '2026-09-22');
    expect((await walking.dashboard(peer)).expeditions[0]).toMatchObject({ steps: 11000, eligibleContributors: 2 });
    expect((await pool.query('SELECT count(*)::int AS n FROM expedition_contributions c JOIN expedition_members m ON c.member_id=m.id WHERE m.user_id=$1', [owner])).rows[0].n).toBe(0);
    await expect(send(owner, { action: 'claimStage', expeditionId: party.id, stage: 0 })).rejects.toMatchObject({ code: 'NOT_EXPEDITION_MEMBER' });
  });

  test('late in-period synchronization and stage claims expire at the exclusive Seoul deadline', async () => {
    const owner = await identity(), peer = await identity(), party = await expedition(owner);
    await send(peer, { action: 'joinExpedition', code: party.inviteCode! });
    const a = await bind(owner), b = await bind(peer);
    clock = Date.parse('2026-09-30T03:00:00Z');
    await sync(owner, a.id, 1, 9000, '2026-09-29');
    await sync(peer, b.id, 1, 1000, '2026-09-29');
    await sync(owner, a.id, 2, 10000, '2026-09-30');
    expect((await walking.dashboard(owner)).expeditions[0]).toMatchObject({ state: 'ended', steps: 10000 });
    await send(owner, { action: 'claimStage', expeditionId: party.id, stage: 0 });
    clock = Date.parse('2026-10-06T15:00:00Z');
    await expect(send(peer, { action: 'claimStage', expeditionId: party.id, stage: 0 })).rejects.toMatchObject({ code: 'STAGE_CLAIM_TIME' });
    await expect(send(peer, { action: 'claimDaily', day: '2026-09-29' })).rejects.toMatchObject({ code: 'DAILY_CLAIM_EXPIRED' });
  });

  test('badge ownership and balance debit are idempotent across fresh command keys', async () => {
    const user = await identity(), source = await bind(user);
    await expect(send(user, { action: 'redeemBadge', badgeId: 'sprout' })).rejects.toMatchObject({ code: 'INSUFFICIENT_POINTS' });
    await sync(user, source.id, 1, 10000);
    await send(user, { action: 'claimDaily', day: '2026-09-22' });
    const results = await Promise.all([send(user, { action: 'redeemBadge', badgeId: 'sprout' }), send(user, { action: 'redeemBadge', badgeId: 'sprout' })]);
    expect(results[0]).toEqual(results[1]);
    const dashboard = await walking.dashboard(user);
    expect(dashboard.balance).toBe(5);
    expect(dashboard.catalog.find((item) => item.id === 'sprout')?.owned).toBe(true);
    expect(dashboard.ledger.filter((entry) => entry.amount < 0)).toHaveLength(1);
  });

  test('every qualified participant receives the same three stage rewards', async () => {
    const owner = await identity(), peer = await identity(), party = await expedition(owner);
    await send(peer, { action: 'joinExpedition', code: party.inviteCode! });
    const a = await bind(owner), b = await bind(peer);
    for (let index = 0; index < 3; index++) {
      const day = shiftDay('2026-09-23', index);
      clock = Date.parse(day + 'T03:00:00Z');
      await sync(owner, a.id, index + 1, 10000);
      await sync(peer, b.id, index + 1, 10000);
      await send(owner, { action: 'claimStage', expeditionId: party.id, stage: index });
      await send(peer, { action: 'claimStage', expeditionId: party.id, stage: index });
    }
    expect((await walking.dashboard(owner)).balance).toBe(35);
    expect((await walking.dashboard(peer)).balance).toBe(35);
    expect((await walking.dashboard(owner)).expeditions[0].stages.every((stage) => stage.claimed)).toBe(true);
  });

  test('balance uses the full ledger while the activity list returns at most fifty rows', async () => {
    const user = await identity(), source = await bind(user);
    const days = Array.from({ length: 8 }, (_, index) => ({ day: shiftDay('2026-09-22', -index), steps: 10000 }));
    await send(user, { action: 'syncHealth', sourceId: source.id, revision: 1, days });
    for (const day of days) await send(user, { action: 'claimDaily', day: day.day });
    const dashboard = await walking.dashboard(user);
    expect(dashboard.balance).toBe(80);
    expect(dashboard.ledger).toHaveLength(50);
    expect(dashboard.days).toHaveLength(8);
  });

  test('an earning failure rolls the claim back with its ledger write', async () => {
    const user = await identity(), source = await bind(user);
    await sync(user, source.id, 1, 1000);
    await pool.query(`CREATE FUNCTION reject_test_walking_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test credit failure'; END; $$`);
    await pool.query('CREATE TRIGGER reject_test_walking_credit BEFORE INSERT ON walking_ledger FOR EACH ROW EXECUTE FUNCTION reject_test_walking_credit()');
    try {
      await expect(send(user, { action: 'claimDaily', day: '2026-09-22' })).rejects.toThrow('test credit failure');
      expect((await pool.query('SELECT count(*)::int AS n FROM walking_claims WHERE user_id=$1', [user])).rows[0].n).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER reject_test_walking_credit ON walking_ledger');
      await pool.query('DROP FUNCTION reject_test_walking_credit()');
    }
    await send(user, { action: 'claimDaily', day: '2026-09-22' });
    expect((await walking.dashboard(user)).balance).toBe(1);
  });

  test('deletion keeps an anonymous shared snapshot and removes private activity and reward data', async () => {
    const owner = await identity('삭제할 이름'), peer = await identity(), party = await expedition(owner);
    await send(peer, { action: 'joinExpedition', code: party.inviteCode! });
    const a = await bind(owner), b = await bind(peer);
    clock = Date.parse('2026-09-23T03:00:00Z');
    await sync(owner, a.id, 1, 4000);
    await sync(peer, b.id, 1, 6000);
    await send(owner, { action: 'claimDaily', day: '2026-09-23' });
    await pool.query('DELETE FROM auth_user WHERE id=$1', [owner]);
    const dashboard = await walking.dashboard(peer), result = dashboard.expeditions[0];
    expect(result).toMatchObject({ steps: 10000, eligibleContributors: 2 });
    expect(result.members.some((member) => member.name === '탈퇴한 사용자' && member.steps === 4000 && member.withdrawn)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('삭제할 이름');
    await send(peer, { action: 'claimStage', expeditionId: party.id, stage: 0 });
    for (const table of ['activity_daily', 'health_sources', 'walking_devices', 'walking_ledger', 'walking_claims', 'walking_commands'])
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id=$1`, [owner])).rows[0].n).toBe(0);
    await expect(walking.dashboard(owner)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  test('every read, replay and command rechecks current account verification', async () => {
    const user = await identity(), key = randomUUID(), input: WalkingCommand = { action: 'bindHealth', deviceId: randomUUID() };
    await send(user, input, key);
    expect(await walking.result(await identity(), key)).toEqual({ id: null });
    await pool.query('UPDATE auth_user SET "emailVerified"=false WHERE id=$1', [user]);
    await expect(walking.dashboard(user)).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    await expect(walking.result(user, key)).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    await expect(send(user, input, key)).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  test('HTTP binds HealthKit only through Native bearer transport and enforces the account envelope', async () => {
    const email = `${randomUUID()}@example.test`, password = 'Walking-Local-' + randomUUID();
    const call = (path: string, method = 'GET', payload?: unknown, headers: Record<string, string> = {}) => fetch(origin + path, {
      method, redirect: 'manual', headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    expect((await call('/api/native/auth/sign-up/email', 'POST', { email, password, name: '전송 시험', callbackURL: '/account' })).status).toBe(200);
    const user = (await pool.query('UPDATE auth_user SET "emailVerified"=true WHERE email=$1 RETURNING id', [email])).rows[0].id as string;
    const login = await call('/api/native/auth/sign-in/email', 'POST', { email, password });
    expect(login.status).toBe(200);
    const { token } = await login.json();
    const native = { Authorization: `Bearer ${token}`, 'X-Cmon-User': user };
    const configuration = await (await call('/api/native/web-session', 'POST', {}, native)).json();
    const browser = { Cookie: `${configuration.cookieName}=${encodeURIComponent(token)}`, Origin: configured, 'X-Cmon-User': user };
    const post = (body: WalkingCommand, headers: Record<string, string>) => call('/api/v1/walking/commands', 'POST', body, { 'Idempotency-Key': randomUUID(), ...headers });
    const binding: WalkingCommand = { action: 'bindHealth', deviceId: randomUUID() };
    expect((await call('/api/v1/me/walking')).status).toBe(401);
    const forbidden = await post(binding, browser);
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('NATIVE_REQUIRED');
    const wrongAccount = await post(binding, { ...native, 'X-Cmon-User': randomUUID() });
    expect(wrongAccount.status).toBe(409);
    expect((await wrongAccount.json()).error.code).toBe('ACCOUNT_CHANGED');
    expect((await post(binding, { Authorization: `Bearer ${token}` })).status).toBe(409);
    const bound = await post(binding, native);
    expect(bound.status).toBe(200);
    const { id: sourceId } = commandResultSchema.parse(await bound.json());
    const syncBody: WalkingCommand = { action: 'syncHealth', sourceId: sourceId!, revision: 1, days: [{ day: '2026-09-22', steps: 2500 }] };
    expect((await post(syncBody, browser)).status).toBe(403);
    expect((await post(syncBody, { ...native, ...browser })).status).toBe(403);
    expect((await post(syncBody, native)).status).toBe(200);
    const response = await call('/api/v1/me/walking', 'GET', undefined, native);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(walkingDashboardSchema.parse(body)).toMatchObject({ userId: user, sourceRevision: 1 });
    const validate = responseContract(await (await call('/api/v1/openapi.json')).json());
    expect(validate('/api/v1/me/walking', 200, body).valid).toBe(true);
    expect((await post({ action: 'claimDaily', day: '2026-09-22' }, browser)).status).toBe(200);
    expect((await post({ action: 'claimDaily', day: '2026-09-22' }, { ...browser, Origin: 'https://foreign.example' })).status).toBe(403);
    const sharedRead = await call('/api/v1/me/walking', 'GET', undefined, browser);
    expect(sharedRead.status).toBe(200);
    expect((await sharedRead.json()).balance).toBe(2);
    const malformed = await fetch(origin + '/api/v1/walking/commands', {
      method: 'POST', headers: { ...native, 'Content-Type': 'application/json' }, body: '{',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: 'INVALID_INPUT', retryable: false } });
    const oversized = await call('/api/v1/walking/commands', 'POST', { title: 'x'.repeat(9000) }, native);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: 'INVALID_INPUT', retryable: false } });
  });

  test('repeatable legacy migrations coexist with the immutable walking migration journal', async () => {
    const user = await identity(), source = await bind(user);
    await sync(user, source.id, 1, 1234);
    await migrateWalking(pool);
    expect((await walking.dashboard(user)).days[0].steps).toBe(1234);
    expect((await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name='006_activity_quests.sql'")).rows[0].n).toBe(1);
    const prior = (await pool.query("SELECT checksum FROM schema_migrations WHERE name='006_activity_quests.sql'")).rows[0].checksum;
    await pool.query("UPDATE schema_migrations SET checksum='changed' WHERE name='006_activity_quests.sql'");
    try { await expect(migrateWalking(pool)).rejects.toThrow('Applied migration changed'); }
    finally { await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE name='006_activity_quests.sql'", [prior]); }
  });
});
