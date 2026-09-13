import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dehydrate } from '@tanstack/react-query';
import { idSchema } from '../contracts/meetup';
import {
  meetingInputSchema,
  meetingCommandSchema,
  meetingFiltersSchema,
  meetingKey,
  meetingListKey,
  membershipKey,
  myMeetingsKey,
} from '../contracts/meetings';
import { accountKey } from '../contracts/account';
import type { MeetingService } from './services/meetings';
import { ServiceError } from './services/meetup';
import type { AuthService } from './auth/service';
import { currentAccount } from './auth/routes';
import { createRequestClient } from './loaders/meetup';
import type { Assets } from './render';
import type { Renderer } from './app';
import { errorPage } from './error-page';

export function registerMeetings(
  app: FastifyInstance,
  service: MeetingService,
  auth: AuthService | undefined,
  renderer: () => Promise<Renderer>,
  assets: Assets,
  deadlineMs: number,
) {
  const account = async (request: FastifyRequest, reply: FastifyReply) =>
    auth ? currentAccount(auth, request, reply) : { user: null };
  const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (await account(request, reply)).user;
    if (!user) throw new ServiceError(401, 'UNAUTHENTICATED', '로그인 후 다시 확인해 주세요.');
    if (!user.emailVerified)
      throw new ServiceError(403, 'EMAIL_NOT_VERIFIED', '이메일 인증을 완료해 주세요.');
    return user.id;
  };
  const handle =
    (fn: (r: FastifyRequest, p: FastifyReply) => Promise<unknown>) =>
    async (r: FastifyRequest, p: FastifyReply) => {
      try {
        return await fn(r, p);
      } catch (error) {
        const e =
          error instanceof ServiceError
            ? error
            : new ServiceError(
                503,
                'UNAVAILABLE',
                '모임 요청을 확인하지 못했습니다. 현재 상태를 다시 조회해 주세요.',
              );
        return p
          .code(e.status)
          .send({
            error: {
              code: e.code,
              message: e.message,
              requestId: r.id,
              retryable: e.status >= 500,
            },
          });
      }
    };
  const idOf = (r: FastifyRequest) => {
    const id = idSchema.safeParse((r.params as { id: string }).id);
    if (!id.success) throw new ServiceError(400, 'INVALID_ID', '잘못된 모임 주소입니다.');
    return id.data.toLowerCase();
  };
  const filtersOf = (r: FastifyRequest) => {
    const parsed = meetingFiltersSchema.safeParse(
      Object.fromEntries(
        Object.entries(r.query as Record<string, unknown>).filter(([, v]) => v !== ''),
      ),
    );
    if (!parsed.success)
      throw new ServiceError(400, 'INVALID_FILTER', '조회 조건을 확인해 주세요.');
    return parsed.data;
  };
  app.get(
    '/api/v1/meetups',
    handle(async (r) => service.list(filtersOf(r))),
  );
  app.get(
    '/api/v1/meetups/:id',
    handle(async (r) => service.detail(idOf(r))),
  );
  app.get(
    '/api/v1/meetups/:id/membership',
    handle(async (r, p) => service.membership(await requireUser(r, p), idOf(r))),
  );
  app.get(
    '/api/v1/me/meetups',
    handle(async (r, p) => service.mine(await requireUser(r, p), filtersOf(r).page)),
  );
  app.get(
    '/api/v1/me/commands/:id',
    handle(async (r, p) => service.commandResult(await requireUser(r, p), idOf(r))),
  );
  const mutate = handle(async (r, p) => {
    // An Authorization header never makes a cookie request exempt from CSRF.
    if (r.headers.cookie || !r.headers.authorization) {
      if (!auth || r.headers.origin !== auth.options.baseURL)
        throw new ServiceError(403, 'INVALID_ORIGIN', '허용되지 않은 요청입니다.');
    }
    const userId = await requireUser(r, p);
    // Prevent a stale tab/form for A from submitting with the new session of B.
    if (r.headers['x-cmon-user'] !== userId)
      throw new ServiceError(
        409,
        'ACCOUNT_CHANGED',
        '계정이 변경되었습니다. 화면을 새로 열어 주세요.',
      );
    const commandId = idSchema.safeParse(r.headers['idempotency-key']);
    const input = (r.method === 'POST' ? meetingInputSchema : meetingCommandSchema).safeParse(
      r.body,
    );
    if (!commandId.success || !input.success)
      throw new ServiceError(400, 'INVALID_INPUT', '제목·시설·일시·정원을 확인해 주세요.');
    return service.command(
      userId,
      commandId.data,
      input.data,
      r.method === 'POST' ? undefined : idOf(r),
    );
  });
  app.post('/api/v1/meetups', { bodyLimit: 16_384 }, mutate);
  app.patch('/api/v1/meetups/:id', { bodyLimit: 16_384 }, mutate);

  const page = async (r: FastifyRequest, p: FastifyReply) => {
    const client = createRequestClient();
    const controller = new AbortController();
    const cleanup = () => {
      clearTimeout(timer);
      controller.abort();
      client.clear();
      p.raw.removeListener('finish', cleanup);
      p.raw.removeListener('close', cleanup);
    };
    const timer = setTimeout(() => {
      if (!p.sent) p.code(504).type('text/html').send(errorPage('응답 시간이 초과되었습니다.'));
      else p.raw.destroy();
      cleanup();
    }, deadlineMs);
    p.raw.once('finish', cleanup);
    p.raw.once('close', cleanup);
    try {
      const mode =
        r.routeOptions.url === '/account/meetups'
          ? 'mine'
          : r.routeOptions.url === '/meetups/new'
            ? 'create'
            : (r.params as { id?: string }).id
              ? 'detail'
              : 'list';
      const filters = filtersOf(r);
      const id = mode === 'detail' ? idOf(r) : undefined;
      const current = await account(r, p);
      const userId = current.user?.id ?? null;
      client.setQueryData(accountKey(userId), current);
      if (id) {
        const [detail, membership] = await Promise.all([
          service.detail(id),
          userId ? service.membership(userId, id) : null,
        ]);
        client.setQueryData(meetingKey(id), detail);
        if (membership) client.setQueryData(membershipKey(userId, id), membership);
      } else if (mode === 'list')
        client.setQueryData(meetingListKey(filters), await service.list(filters));
      else if (mode === 'mine' && userId)
        client.setQueryData(
          myMeetingsKey(userId, filters.page),
          await service.mine(userId, filters.page),
        );
      const render = await renderer();
      if (!controller.signal.aborted)
        render(
          p,
          {
            route: { section: 'meetings', mode, id, filters, userId },
            dehydratedState: dehydrate(client),
          },
          client,
          assets,
          controller.signal,
        );
    } catch (error) {
      if (!p.sent && !controller.signal.aborted)
        p.code(error instanceof ServiceError ? error.status : 503)
          .type('text/html')
          .send(
            errorPage(
              error instanceof ServiceError ? error.message : '모임을 불러오지 못했습니다.',
            ),
          );
      cleanup();
    }
    return p;
  };
  for (const path of ['/meetups', '/meetups/new', '/meetups/:id', '/account/meetups'])
    app.get(path, page);
}
