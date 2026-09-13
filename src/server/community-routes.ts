import type { MeetingService } from './services/meetings';
import { myMeetingsKey } from '../contracts/meetings';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { dehydrate } from '@tanstack/react-query';
import {
  communityCommandSchema,
  communityFiltersSchema,
  communityKey,
} from '../contracts/community';
import { idSchema } from '../contracts/meetup';
import { accountKey } from '../contracts/account';
import { currentAccount } from './auth/routes';
import type { AuthService } from './auth/service';
import type { CommunityService } from './services/community';
import { ServiceError } from './services/meetup';
import { createRequestClient } from './loaders/meetup';
import { errorPage } from './error-page';
import type { Renderer } from './app';
import type { Assets } from './render';
export function registerCommunity(
  app: FastifyInstance,
  service: CommunityService,
  auth: AuthService | undefined,
  renderer: () => Promise<Renderer>,
  assets: Assets,
  deadlineMs: number,
  meetings?: MeetingService,
) {
  const viewer = async (r: FastifyRequest, p: FastifyReply) => {
    const a = auth ? await currentAccount(auth, r, p) : { user: null };
    if (
      r.method === 'GET' &&
      r.headers['x-cmon-user'] !== undefined &&
      r.headers['x-cmon-user'] !== (a.user?.id ?? 'guest')
    )
      throw new ServiceError(
        409,
        'ACCOUNT_CHANGED',
        '계정이 변경되었습니다. 화면을 새로 열어 주세요.',
      );
    return a;
  };
  const idOf = (r: FastifyRequest) => {
    const v = idSchema.safeParse((r.params as { id?: string }).id);
    if (!v.success) throw new ServiceError(400, 'INVALID_ID', '주소를 확인해 주세요.');
    return v.data.toLowerCase();
  };
  const filters = (r: FastifyRequest) => {
    const v = communityFiltersSchema.safeParse(
      Object.fromEntries(Object.entries(r.query as object).filter(([, v]) => v !== '')),
    );
    if (!v.success || (v.data.cursor && !Number.isFinite(Date.parse(v.data.cursor.split('~')[0]))))
      throw new ServiceError(400, 'INVALID_FILTER', '조회 조건을 확인해 주세요.');
    return v.data;
  };
  const requireUser = async (r: FastifyRequest, p: FastifyReply) => {
    const a = await viewer(r, p);
    if (!a.user) throw new ServiceError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
    if (!a.user.emailVerified)
      throw new ServiceError(403, 'EMAIL_NOT_VERIFIED', '이메일 인증이 필요합니다.');
    return a.user.id;
  };
  const handle =
    (fn: (r: FastifyRequest, p: FastifyReply) => Promise<unknown>) =>
    async (r: FastifyRequest, p: FastifyReply) => {
      try {
        return await fn(r, p);
      } catch (e) {
        const err =
          e instanceof ServiceError
            ? e
            : new ServiceError(
                503,
                'UNAVAILABLE',
                '요청을 확인하지 못했습니다. 현재 상태를 다시 확인해 주세요.',
              );
        return p.code(err.status).send({
          error: {
            code: err.code,
            message: err.message,
            requestId: r.id,
            retryable: err.status >= 500,
          },
        });
      }
    };
  app.get(
    '/api/v1/posts',
    handle(async (r, p) => service.list((await viewer(r, p)).user?.id ?? null, filters(r))),
  );
  app.get(
    '/api/v1/posts/:id',
    handle(async (r, p) => service.detail((await viewer(r, p)).user?.id ?? null, idOf(r))),
  );
  for (const kind of ['posts', 'meetups'] as const)
    app.get(
      `/api/v1/${kind}/:id/comments`,
      handle(async (r, p) =>
        service.comments(
          (await viewer(r, p)).user?.id ?? null,
          kind === 'posts' ? 'post' : 'meetup',
          idOf(r),
          filters(r).page,
          filters(r).cursor,
        ),
      ),
    );
  app.get(
    '/api/v1/me/profile',
    handle(async (r, p) => service.profile(await requireUser(r, p))),
  );
  app.get(
    '/api/v1/me/blocks',
    handle(async (r, p) => service.blocks(await requireUser(r, p))),
  );
  app.get(
    '/api/v1/me/community-commands/:id',
    handle(async (r, p) => service.result(await requireUser(r, p), idOf(r))),
  );
  app.post(
    '/api/v1/community/commands',
    { bodyLimit: 20000 },
    handle(async (r, p) => {
      if (
        (r.headers.cookie || !r.headers.authorization) &&
        (!auth || r.headers.origin !== auth.options.baseURL)
      )
        throw new ServiceError(403, 'INVALID_ORIGIN', '허용되지 않은 요청입니다.');
      const user = await requireUser(r, p);
      if (r.headers['x-cmon-user'] !== user)
        throw new ServiceError(409, 'ACCOUNT_CHANGED', '계정이 변경되었습니다.');
      const key = idSchema.safeParse(r.headers['idempotency-key']),
        input = communityCommandSchema.safeParse(r.body);
      if (!key.success || !input.success)
        throw new ServiceError(400, 'INVALID_INPUT', '입력을 확인해 주세요.');
      return service.command(user, key.data, input.data);
    }),
  );
  const page = async (r: FastifyRequest, p: FastifyReply) => {
    const client = createRequestClient(),
      controller = new AbortController();
    const cleanup = () => {
      clearTimeout(timer);
      controller.abort();
      client.clear();
      p.raw.off('close', cleanup);
      p.raw.off('finish', cleanup);
    };
    const timer = setTimeout(() => {
      if (!p.raw.headersSent && !p.sent && !p.raw.destroyed)
        p.code(504).type('text/html').send(errorPage('응답 시간이 초과되었습니다.'));
      else p.raw.destroy();
      cleanup();
    }, deadlineMs);
    p.raw.once('close', cleanup);
    p.raw.once('finish', cleanup);
    try {
      const a = await viewer(r, p),
        userId = a.user?.id ?? null;
      client.setQueryData(accountKey(userId), a);
      const mode =
        r.routeOptions.url === '/activity'
          ? 'activity'
          : r.routeOptions.url === '/community/new'
            ? 'create'
            : r.routeOptions.url === '/account/posts'
              ? 'mine'
              : r.routeOptions.url?.includes('/meetups/')
                ? 'discussion'
                : (r.params as { id?: string }).id
                  ? 'detail'
                  : 'list';
      const f = filters(r),
        id = mode === 'detail' || mode === 'discussion' ? idOf(r) : undefined;
      if (mode === 'detail')
        client.setQueryData(communityKey(userId, 'post', id), await service.detail(userId, id!));
      if (mode === 'detail' || mode === 'discussion')
        client.setQueryData(
          communityKey(userId, 'comments', mode === 'detail' ? 'post' : 'meetup', id, 0),
          await service.comments(userId, mode === 'detail' ? 'post' : 'meetup', id!),
        );
      if (mode === 'list' || (mode === 'mine' && userId)) {
        const filter = { ...f, ...(mode === 'mine' ? { mine: '1' as const } : {}) };
        client.setQueryData(
          communityKey(userId, 'list', filter),
          await service.list(userId, filter),
        );
      }
      if (mode === 'activity' && userId) {
        await Promise.all([
          service
            .profile(userId)
            .then((data) => client.setQueryData(communityKey(userId, 'profile'), data)),
          service
            .list(userId, { page: 0, mine: '1' })
            .then((data) =>
              client.setQueryData(communityKey(userId, 'list', { page: 0, mine: '1' }), data),
            ),
          meetings?.mine(userId).then((data) => client.setQueryData(myMeetingsKey(userId), data)),
        ]);
      }
      const render = await renderer();
      if (!controller.signal.aborted)
        await render(
          p,
          {
            url: r.url,
            route: { section: 'community', mode, id, userId },
            dehydratedState: dehydrate(client),
          },
          client,
          assets,
          controller.signal,
        );
    } catch (e) {
      if (!p.sent && !p.raw.headersSent && !p.raw.destroyed && !controller.signal.aborted)
        p.code(e instanceof ServiceError ? e.status : 503)
          .type('text/html')
          .send(errorPage(e instanceof ServiceError ? e.message : '화면을 불러오지 못했습니다.'));
      cleanup();
    }
    return p;
  };
  for (const path of [
    '/activity',
    '/community',
    '/community/new',
    '/community/:id',
    '/account/posts',
    '/meetups/:id/discussion',
  ])
    app.get(path, page);
}
