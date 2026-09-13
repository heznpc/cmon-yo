import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth, socialProviders } from '../src/server/auth/service';
import type { AuthMail } from '../src/server/auth/mail';
import { createApp } from '../src/server/app';
import { renderPage } from '../src/server/render';
import { accountReturnPath, accountSchema } from '../src/contracts/account';
import { databaseTypes } from '../src/server/db';
import { responseContract } from './helpers/openapi';

test('return paths stay within product screens; partial providers and unsafe DB integers are rejected', () => {
  for (const value of [
    'https://other.invalid',
    '//other.invalid',
    '/\\other.invalid',
    '/api/auth/sign-out',
    '/places/../../api/auth',
  ])
    expect(accountReturnPath(value)).toBe('/account');
  expect(accountReturnPath('/places/abc?date=2026-10-01')).toBe('/places/abc?date=2026-10-01');
  expect(socialProviders({})).toEqual({});
  expect(() => socialProviders({ GOOGLE_CLIENT_ID: 'test-client' })).toThrow();
  expect(databaseTypes.getTypeParser(20)('1789276311700')).toBe(1789276311700);
  expect(() => databaseTypes.getTypeParser(20)('9223372036854775807')).toThrow();
});

describe.runIf(process.env.TEST_DATABASE_URL)(
  'actual PostgreSQL and HTTP account lifecycle',
  () => {
    const schema = 'auth_test_' + randomUUID().replaceAll('-', '');
    const expectedOrigin = 'http://127.0.0.1:3189';
    const mail: AuthMail[] = [];
    let admin: pg.Pool;
    let pool: pg.Pool;
    let app: ReturnType<typeof createApp>;
    let origin: string;
    const password = 'local-test-' + randomBytes(20).toString('hex');
    const email = `account-${randomUUID()}@example.test`;
    const request = (
      path: string,
      body?: object,
      cookie?: string,
      headers: Record<string, string> = {},
    ) =>
      fetch(origin + path, {
        method: body ? 'POST' : 'GET',
        redirect: 'manual',
        headers: {
          Origin: expectedOrigin,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const cookieFrom = (response: Response) =>
      response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
    beforeAll(async () => {
      admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        options: `-c search_path=${schema}`,
        types: databaseTypes,
      });
      const auth = createAuth({
        pool,
        origin: expectedOrigin,
        secret: randomBytes(32).toString('hex'),
        sendMail: async (message) => {
          mail.push(message);
        },
      });
      const migration = await getMigrations(auth.options);
      expect(migration.unsafeChanges).toEqual([]);
      await migration.runMigrations();
      app = createApp({ auth, renderer: async () => renderPage });
      origin = await app.listen({ host: '127.0.0.1', port: 0 });
    }, 30_000);
    afterAll(async () => {
      await app?.close();
      await pool?.end();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
      }
    });

    test('verification, renewal, sign-out, reset, rate-limit recovery and confirmed deletion use real HTTP and DB', async () => {
      const validate = responseContract(await (await request('/api/v1/openapi.json')).json());
      const anonymous = await request('/api/v1/me');
      expect(anonymous.status).toBe(401);
      expect(validate('/api/v1/me', 401, await anonymous.json()).valid).toBe(true);
      expect((await request('/api/auth/get-session')).status).toBe(404);
      const signup = await request('/api/auth/sign-up/email', {
        email,
        password,
        name: '운동 사용자',
        callbackURL: '/account',
      });
      expect(signup.status, await signup.text()).toBe(200);
      expect(mail.filter((value) => value.purpose === 'verify')).toHaveLength(1);
      const blocked = await request('/api/auth/sign-in/email', { email, password });
      expect(blocked.status).toBe(403);
      const verification = new URL(mail[0].url);
      const verified = await request(verification.pathname + verification.search);
      expect(verified.status).toBe(302);
      const login = await request('/api/auth/sign-in/email', { email, password });
      expect(login.status, await login.clone().text()).toBe(200);
      expect(await login.text()).not.toContain('"token"');
      const cookie = cookieFrom(login);
      expect(cookie).toContain('cmon.session_token');
      const me = await (await request('/api/v1/me', undefined, cookie)).json();
      expect(accountSchema.parse(me).user?.email).toBe(email);
      expect(validate('/api/v1/me', 200, me).valid).toBe(true);
      expect(Object.keys(me.user).sort()).toEqual(['email', 'emailVerified', 'id', 'name']);
      // A real renewal must reach the browser as well as update the database.
      await pool.query(
        'UPDATE auth_session SET "updatedAt" = NOW() - INTERVAL \'2 days\', "expiresAt" = NOW() + INTERVAL \'5 days\' WHERE "userId" = $1',
        [me.user.id],
      );
      const renewed = await request('/api/v1/me', undefined, cookie);
      expect(renewed.status).toBe(200);
      expect(renewed.headers.getSetCookie().join(';')).toContain('HttpOnly');
      const [privatePage, anonymousPage] = await Promise.all([
        request('/account', undefined, cookie).then((response) => response.text()),
        request('/account').then((response) => response.text()),
      ]);
      expect(privatePage).toContain('운동 사용자');
      expect(anonymousPage).not.toContain(email);
      expect(privatePage).not.toContain('"token"');
      const crossSite = await request('/api/auth/sign-out', {}, cookie, {
        Origin: 'https://other.invalid',
      });
      expect(crossSite.status).toBe(403);
      expect((await request('/api/v1/me', undefined, cookie)).status).toBe(200);
      expect((await request('/api/auth/sign-out', {}, cookie)).status).toBe(200);
      expect((await request('/api/v1/me', undefined, cookie)).status).toBe(401);
      const nextLogin = await request('/api/auth/sign-in/email', { email, password });
      const oldSession = cookieFrom(nextLogin);
      expect(nextLogin.status).toBe(200);
      expect(
        (
          await request('/api/auth/request-password-reset', {
            email,
            redirectTo: '/account?mode=reset',
          })
        ).status,
      ).toBe(200);
      const reset = mail.find((value) => value.purpose === 'reset');
      expect(reset).toBeDefined();
      const resetURL = new URL(reset!.url);
      const resetRedirect = await request(resetURL.pathname + resetURL.search);
      expect(resetRedirect.status).toBe(302);
      const token = new URL(
        resetRedirect.headers.get('location')!,
        expectedOrigin,
      ).searchParams.get('token');
      const changedPassword = password + '-new';
      expect(
        (await request('/api/auth/reset-password', { token, newPassword: changedPassword })).status,
      ).toBe(200);
      expect((await request('/api/v1/me', undefined, oldSession)).status).toBe(401);
      expect(
        (await request('/api/auth/reset-password', { token, newPassword: password })).status,
      ).toBe(400);
      let recovered = await request('/api/auth/sign-in/email', {
        email,
        password: changedPassword,
      });
      if (recovered.status === 429) {
        expect(await recovered.json()).toMatchObject({
          error: { requestId: expect.any(String), retryable: false },
        });
        const seconds = Number(recovered.headers.get('retry-after'));
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(10);
        await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
        recovered = await request('/api/auth/sign-in/email', { email, password: changedPassword });
      }
      expect(recovered.status, await recovered.text()).toBe(200);
      const recoveredCookie = cookieFrom(recovered);
      expect(
        (await request('/api/auth/delete-user', { callbackURL: '/account' }, recoveredCookie))
          .status,
      ).toBe(200);
      expect((await request('/api/v1/me', undefined, recoveredCookie)).status).toBe(200);
      const deletion = new URL(mail.find((value) => value.purpose === 'delete')!.url);
      expect(
        (await request(deletion.pathname + deletion.search, undefined, recoveredCookie)).status,
      ).toBe(302);
      expect((await request('/api/v1/me', undefined, recoveredCookie)).status).toBe(401);
      expect(
        (await pool.query('SELECT id FROM auth_user WHERE id = $1', [me.user.id])).rows,
      ).toHaveLength(0);
      expect(
        (await pool.query('SELECT id FROM auth_account WHERE "userId" = $1', [me.user.id])).rows,
      ).toHaveLength(0);
      expect(
        (await pool.query('SELECT id FROM auth_session WHERE "userId" = $1', [me.user.id])).rows,
      ).toHaveLength(0);
    }, 30_000);

    test('two concurrent account SSR responses are isolated; expired sessions are rejected', async () => {
      const accounts = [];
      for (const name of ['사용자 가', '사용자 나']) {
        const userEmail = `isolation-${randomUUID()}@example.test`;
        expect(
          (
            await request('/api/auth/sign-up/email', {
              email: userEmail,
              password,
              name,
              callbackURL: '/account',
            })
          ).status,
        ).toBe(200);
        const verify = new URL(
          mail.find((value) => value.to === userEmail && value.purpose === 'verify')!.url,
        );
        expect((await request(verify.pathname + verify.search)).status).toBe(302);
        const login = await request('/api/auth/sign-in/email', { email: userEmail, password });
        expect(login.status).toBe(200);
        const cookie = cookieFrom(login);
        const me = await (await request('/api/v1/me', undefined, cookie)).json();
        accounts.push({ cookie, email: userEmail, id: me.user.id });
      }
      const pages = await Promise.all(
        accounts.map(async (account) => {
          const response = await request('/account', undefined, account.cookie);
          expect(response.headers.get('cache-control')).toBe('private, no-store');
          return response.text();
        }),
      );
      for (const index of [0, 1]) {
        expect(pages[index]).toContain(accounts[index].email);
        expect(pages[index]).not.toContain(accounts[1 - index].email);
        expect(pages[index]).not.toContain('"token"');
      }
      await pool.query(
        'UPDATE auth_session SET "expiresAt" = NOW() - INTERVAL \'1 second\' WHERE "userId" = $1',
        [accounts[0].id],
      );
      expect((await request('/api/v1/me', undefined, accounts[0].cookie)).status).toBe(401);
      expect((await request('/api/v1/me', undefined, accounts[1].cookie)).status).toBe(200);
    }, 30_000);
  },
);
