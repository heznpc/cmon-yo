import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { AuthService } from './service';
import { accountNameSchema, accountSchema, type Account } from '../../contracts/account';

export function validAccountName(value: unknown): value is string {
  return accountNameSchema.safeParse(value).success;
}

export async function currentAccount(
  auth: AuthService | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
  readOnly = false,
): Promise<Account> {
  if (!auth) throw new Error('Authentication unavailable.');
  const headers = fromNodeHeaders(request.headers);
  // Bearer and browser credentials never fall back to one another.
  if (headers.has('authorization')) headers.delete('cookie');
  const session = await auth.api.getSession({
    headers,
    query: { disableRefresh: readOnly },
    returnHeaders: true,
  });
  const cookies = session.headers.getSetCookie();
  if (!readOnly && cookies.length && !reply.sent && !headers.has('authorization'))
    reply.header('set-cookie', cookies);
  return accountSchema.parse({ user: session.response?.user ?? null });
}

export function registerAuthRoutes(app: FastifyInstance, auth?: AuthService) {
  const fail = (requestId: string) => ({
    error: {
      code: 'AUTH_UNAVAILABLE',
      message: '계정 서비스를 불러오지 못했습니다.',
      requestId,
      retryable: true,
    },
  });
  app.get('/api/v1/me', async (request, reply) => {
    try {
      const account = await currentAccount(auth, request, reply);
      const expected = request.headers['x-cmon-user'];
      if (expected !== undefined && expected !== (account.user?.id ?? 'guest'))
        return reply.code(409).send({ error: {
          code: 'ACCOUNT_CHANGED',
          message: '계정이 변경되었습니다. 화면을 새로 열어 주세요.',
          requestId: request.id,
          retryable: false,
        } });
      return account.user
        ? account
        : reply.code(401).send({
            error: {
              code: 'UNAUTHENTICATED',
              message: '로그인이 필요합니다.',
              requestId: request.id,
              retryable: false,
            },
          });
    } catch {
      return reply.code(503).send(fail(request.id));
    }
  });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, String(body)),
  );
  app.get('/api/auth/providers', async (_request, reply) => {
    if (!auth) return reply.code(503).send({ providers: [] });
    return { providers: Object.keys(auth.options.socialProviders ?? {}) };
  });
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    bodyLimit: 16_384,
    handler: async (request, reply) => {
      if (!auth) return reply.code(503).send(fail(request.id));
      const path = new URL(request.url, 'http://local.invalid').pathname.slice('/api/auth/'.length);
      // All product mutations require our origin. Provider callbacks instead
      // use the library's state/nonce verification and provider-specific rules.
      if (
        request.method === 'POST' &&
        !/^callback\/(google|kakao|naver|apple)$/.test(path) &&
        request.headers.origin !== auth.options.baseURL
      )
        return reply.code(403).send({
          error: {
            code: 'INVALID_ORIGIN',
            message: '허용되지 않은 계정 요청입니다.',
            requestId: request.id,
            retryable: false,
          },
        });
      const allowed = new Set([
        'sign-up/email',
        'sign-in/email',
        'sign-in/social',
        'sign-out',
        'verify-email',
        'send-verification-email',
        'request-password-reset',
        'reset-password',
        'delete-user',
        'delete-user/callback',
        'list-accounts',
        'link-social',
        'unlink-account',
        'change-password',
        'update-user',
      ]);
      if (
        !allowed.has(path) &&
        !/^callback\/(google|kakao|naver|apple)$/.test(path) &&
        !/^reset-password\/[A-Za-z0-9_-]+$/.test(path)
      )
        return reply.code(404).send({
          error: {
            code: 'NOT_FOUND',
            message: '지원하지 않는 계정 요청입니다.',
            requestId: request.id,
            retryable: false,
          },
        });
      // PostgreSQL text cannot store NUL. Reject malformed account names before
      // they reach the auth adapter, rather than reporting an internal outage.
      if (request.method === 'POST' && ['sign-up/email', 'update-user'].includes(path)) {
        const body = request.body;
        const name = typeof body === 'object' && body !== null && 'name' in body
          ? body.name
          : undefined;
        if ((path === 'sign-up/email' || name !== undefined) && !validAccountName(name))
          return reply.code(400).send({
            error: {
              code: 'INVALID_INPUT',
              message: '이름은 1자 이상 60자 이하로 입력해 주세요.',
              requestId: request.id,
              retryable: false,
            },
          });
        if (name !== undefined)
          request.body = { ...(body as Record<string, unknown>), name: accountNameSchema.parse(name) };
      }
      try {
        const headers = fromNodeHeaders(request.headers);
        // Fastify trusts the socket peer by default. Replace, never forward, a
        // caller-supplied rate-limit identity. Proxy trust is a deployment setting.
        headers.set('x-cmon-client-ip', request.ip);
        // Use the configured origin, never an untrusted Host header, for redirects.
        const response = await auth.handler(
          new Request(new URL(request.url, auth.options.baseURL as string), {
            method: request.method,
            headers,
            ...(request.body
              ? {
                  body:
                    typeof request.body === 'string' ? request.body : JSON.stringify(request.body),
                }
              : {}),
          }),
        );
        reply.code(response.status).header('Referrer-Policy', 'no-referrer');
        for (const [name, value] of response.headers)
          if (
            ![
              'set-cookie',
              'content-length',
              'set-auth-token',
              'access-control-expose-headers',
            ].includes(name)
          )
            reply.header(name, value);
        const retryAfter = response.headers.get('x-retry-after');
        if (retryAfter) reply.header('Retry-After', retryAfter);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header('set-cookie', cookies);
        const text = await response.text();
        if (response.status >= 400) {
          let code = 'AUTH_FAILED';
          try {
            const value = JSON.parse(text);
            if (typeof value.code === 'string') code = value.code;
          } catch {
            /* Do not expose upstream bodies. */
          }
          return reply.type('application/json').send({
            error: {
              code,
              message: '계정 요청을 처리하지 못했습니다.',
              requestId: request.id,
              retryable: response.status >= 500,
            },
          });
        }
        if (text && response.headers.get('content-type')?.includes('application/json')) {
          const parsed: unknown = JSON.parse(text);
          // Keep session/provider credentials in cookies or on the server even
          // when a library action also includes them in its JSON response.
          const publicBody = JSON.parse(
            JSON.stringify(parsed, (key, value) =>
              ['token', 'accessToken', 'refreshToken', 'idToken', 'password'].includes(key)
                ? undefined
                : value,
            ),
          );
          return reply.type('application/json').send(publicBody);
        }
        return reply.send(text);
      } catch {
        return reply.code(503).type('application/json').send(fail(request.id));
      }
    },
  });
}
