import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dehydrate } from '@tanstack/react-query';
import { z } from 'zod';
import { walkingCommandSchema, walkingDashboardSchema, walkingKey } from '../contracts/walking';
import { accountKey } from '../contracts/account';
import { currentAccount } from './auth/routes';
import type { AuthService } from './auth/service';
import { ServiceError } from './services/meetup';
import type { databaseWalking } from './walking/service';
import { createRequestClient } from './loaders/meetup';
import type { Renderer } from './app';
import type { Assets } from './render';
import { errorPage } from './error-page';
export type WalkingService = ReturnType<typeof databaseWalking>;

export function registerWalking(
  app: FastifyInstance,
  service: WalkingService | undefined,
  auth: AuthService | undefined,
  renderer: () => Promise<Renderer>,
  assets: Assets,
  deadlineMs: number,
) {
  // Failed invitations must consume a budget too. Bound memory without a timer;
  // successful commands also have a durable cross-process database budget.
  const attempts = new Map<string, { started: number; count: number }>();
  const takeAttempt = (userId: string, reply: FastifyReply) => {
    const now = Date.now();
    for (const [id, window] of attempts)
      if (now - window.started >= 60000) attempts.delete(id);
    let window = attempts.get(userId);
    if (!window && attempts.size < 10000) {
      window = { started: now, count: 0 };
      attempts.set(userId, window);
    }
    if (!window || window.count >= 60) {
      reply.header('Retry-After', '60');
      throw new ServiceError(429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.');
    }
    window.count++;
  };
  const getService = () => {
    if (!service) throw new ServiceError(503, 'UNAVAILABLE', '걷기 서비스를 준비하고 있습니다.');
    return service;
  };
  const viewer = async (request: FastifyRequest, reply: FastifyReply) => {
    const account = auth ? await currentAccount(auth, request, reply) : { user: null };
    const expected = request.headers['x-cmon-user'];
    if (expected !== undefined && expected !== (account.user?.id ?? 'guest'))
      throw new ServiceError(409, 'ACCOUNT_CHANGED', '계정이 변경되었습니다.');
    return account;
  };
  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const account = await viewer(request, reply);
    if (!account.user) throw new ServiceError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
    if (!account.user.emailVerified)
      throw new ServiceError(403, 'EMAIL_NOT_VERIFIED', '이메일 인증이 필요합니다.');
    return account.user.id;
  };
  const handle = (work: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try { return await work(request, reply); }
      catch (error) {
        const failure = error instanceof ServiceError ? error : new ServiceError(503, 'UNAVAILABLE', '요청 결과를 확인하지 못했습니다.');
        if (failure.status >= 500)
          request.observe({ event: 'server_error', phase: 'walking_api', status: failure.status });
        return reply.code(failure.status).send({ error: {
          code: failure.code, message: failure.message, requestId: request.id, retryable: failure.status >= 500,
        } });
      }
    };
  app.get('/api/v1/me/walking', handle(async (request, reply) =>
    walkingDashboardSchema.parse(await getService().dashboard(await requireUser(request, reply))),
  ));
  app.get('/api/v1/me/walking-commands/:id', handle(async (request, reply) => {
    const id = z.uuid().safeParse((request.params as { id: string }).id);
    if (!id.success) throw new ServiceError(400, 'INVALID_INPUT', '요청 번호를 확인해 주세요.');
    return getService().result(await requireUser(request, reply), id.data.toLowerCase());
  }));
  app.post('/api/v1/walking/commands', {
    bodyLimit: 8192,
    errorHandler: (error, request, reply) => {
      const status = [400, 413, 415].includes(error.statusCode ?? 0) ? error.statusCode! : 503;
      return reply.code(status).send({ error: {
        code: status === 503 ? 'UNAVAILABLE' : 'INVALID_INPUT',
        message: status === 413 ? '보낸 내용이 너무 큽니다.' : '요청 내용을 확인하지 못했습니다.',
        requestId: request.id,
        retryable: status === 503,
      } });
    },
  }, handle(async (request, reply) => {
    if ((!request.headers.authorization || request.headers.cookie) &&
        (!auth || request.headers.origin !== auth.options.baseURL))
      throw new ServiceError(403, 'INVALID_ORIGIN', '허용되지 않은 요청입니다.');
    const userId = await requireUser(request, reply);
    takeAttempt(userId, reply);
    if (request.headers['x-cmon-user'] !== userId)
      throw new ServiceError(409, 'ACCOUNT_CHANGED', '계정이 변경되었습니다.');
    const key = z.uuid().safeParse(request.headers['idempotency-key']);
    const input = walkingCommandSchema.safeParse(request.body);
    if (!key.success || !input.success)
      throw new ServiceError(400, 'INVALID_INPUT', '입력한 내용을 확인해 주세요.');
    // Health readings are accepted through the authenticated Native transport only.
    // A Native credential is not an attestation of physical activity.
    if (['bindHealth', 'syncHealth'].includes(input.data.action) &&
        (!request.headers.authorization?.startsWith('Bearer ') || request.headers.cookie))
      throw new ServiceError(403, 'NATIVE_REQUIRED', '걷기 기록은 iOS 앱에서 연결해 주세요.');
    return getService().command(userId, key.data.toLowerCase(), input.data);
  }));
  app.get('/quests', async (request, reply) => {
    const client = createRequestClient();
    const controller = new AbortController();
    const cleanup = () => {
      clearTimeout(timer);
      controller.abort();
      client.clear();
      reply.raw.off('close', cleanup);
      reply.raw.off('finish', cleanup);
    };
    const timer = setTimeout(() => {
      request.observe({ event: 'server_error', phase: 'walking_ssr_deadline', status: 504 });
      if (!reply.sent && !reply.raw.headersSent && !reply.raw.destroyed)
        reply.code(504).type('text/html').send(errorPage('화면을 불러오는 시간이 초과되었습니다.'));
      else reply.raw.destroy();
      cleanup();
    }, deadlineMs);
    reply.raw.once('close', cleanup);
    reply.raw.once('finish', cleanup);
    try {
      const account = await viewer(request, reply);
      const userId = account.user?.id ?? null;
      client.setQueryData(accountKey(userId), account);
      // A failed dashboard request renders the same retryable React state as a
      // failed client refresh, rather than replacing the complete page shell.
      if (userId && account.user?.emailVerified) {
        await client.prefetchQuery({ queryKey: walkingKey(userId), retry: false,
          queryFn: async () => {
            try { return walkingDashboardSchema.parse(await getService().dashboard(userId)); }
            catch (error) {
              const status = error instanceof ServiceError ? error.status : 503;
              if (status >= 500)
                request.observe({ event: 'server_error', phase: 'walking_ssr_dashboard', status });
              throw error;
            }
          },
        });
      }
      const render = await renderer();
      if (!controller.signal.aborted)
        await render(reply, { url: request.url, route: { section: 'quests', userId },
          dehydratedState: dehydrate(client) }, client, assets, controller.signal);
    } catch (error) {
      const status = error instanceof ServiceError ? error.status : 503;
      if (status >= 500)
        request.observe({ event: 'server_error', phase: 'walking_ssr', status });
      if (!controller.signal.aborted && !reply.sent && !reply.raw.headersSent && !reply.raw.destroyed)
        reply.code(status).type('text/html')
          .send(errorPage('걷기 화면을 불러오지 못했습니다. 다시 시도해 주세요.'));
      cleanup();
    }
    return reply;
  });
}
