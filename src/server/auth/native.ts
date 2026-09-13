import { getCookies } from 'better-auth/cookies';
import { currentAccount } from './routes';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from './service';

// Native uses the same verified email accounts and revocable server sessions.
// A separate transport drops browser cookies and never exposes a credential on
// the Web auth endpoints. No CORS permission is granted to other origins.
export function registerNativeAuth(app: FastifyInstance, auth?: AuthService) {
  app.post('/api/native/web-session', { bodyLimit: 1024 }, async (request, reply) => {
    const fail = (status: number, code: string) =>
      reply.code(status).send({ error: { code, requestId: request.id, retryable: status >= 500 } });
    if (!auth) return fail(503, 'AUTH_UNAVAILABLE');
    if (request.headers.cookie || request.headers.origin || request.headers['sec-fetch-site'])
      return fail(403, 'INVALID_ORIGIN');
    if (!request.headers.authorization?.startsWith('Bearer ')) return fail(401, 'UNAUTHENTICATED');
    try {
      const account = await currentAccount(auth, request, reply);
      if (!account.user?.emailVerified) return fail(401, 'UNAUTHENTICATED');
      // The already verified signed Native credential is also a valid session
      // cookie. Return configuration only; never send credentials to browser JS.
      const cookie = getCookies(auth.options).sessionToken;
      return { userId: account.user.id, cookieName: cookie.name, secure: cookie.attributes.secure };
    } catch {
      return fail(503, 'AUTH_UNAVAILABLE');
    }
  });
  for (const action of [
    'sign-in/email',
    'sign-up/email',
    'sign-out',
    'send-verification-email',
    'request-password-reset',
  ] as const) {
    app.post(`/api/native/auth/${action}`, { bodyLimit: 16_384 }, async (request, reply) => {
      const fail = (status: number, code: string) =>
        reply.code(status).send({
          error: {
            code,
            message: '계정 요청을 처리하지 못했습니다.',
            requestId: request.id,
            retryable: status >= 500,
          },
        });
      if (!auth) return fail(503, 'AUTH_UNAVAILABLE');
      if (request.headers.cookie || request.headers.origin || request.headers['sec-fetch-site'])
        return fail(403, 'INVALID_ORIGIN');
      if (action === 'sign-out' && !request.headers.authorization?.startsWith('Bearer '))
        return fail(401, 'UNAUTHENTICATED');
      try {
        const headers = new Headers({
          'Content-Type': 'application/json',
          origin: auth.options.baseURL as string,
          'x-cmon-client-ip': request.ip,
        });
        if (request.headers.authorization)
          headers.set('Authorization', request.headers.authorization);
        const result = await auth.handler(
          new Request(`${auth.options.baseURL}/api/auth/${action}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(request.body ?? {}),
          }),
        );
        const body = await result.json();
        if (!result.ok) {
          const retry = result.headers.get('x-retry-after');
          if (retry) reply.header('Retry-After', retry);
          return fail(result.status, typeof body.code === 'string' ? body.code : 'AUTH_FAILED');
        }
        if (action === 'sign-in/email') {
          const token = result.headers.get('set-auth-token');
          if (!token) return fail(503, 'AUTH_UNAVAILABLE');
          return { token };
        }
        return { success: true };
      } catch {
        return fail(503, 'AUTH_UNAVAILABLE');
      }
    });
  }
}
