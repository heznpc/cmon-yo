import { randomUUID } from 'node:crypto';
import { deferState } from './deferred';
import type { StreamResources } from '../app/stream';
import { weatherKey, type PlaceInfo, placeKey } from '../contracts/place';
import { errorPage } from './error-page';
import Fastify, { type FastifyRequest } from 'fastify';
import { idSchema } from '../contracts/meetup';
import { fixtureService, ServiceError, type MeetupService } from './services/meetup';
import { createRequestClient, loadMeetup } from './loaders/meetup';
import type { renderPage, Assets } from './render';
import { placeIdSchema } from '../contracts/place';
import { databasePlaces, type PlaceService } from './services/place';
import { kmaWeather } from './weather/kma';
import { loadPlaces } from './loaders/place';
import { openapi } from './openapi';
import { currentAccount, registerAuthRoutes } from './auth/routes';
import type { AuthService } from './auth/service';
import { accountKey, accountReturnPath } from '../contracts/account';
import { dehydrate } from '@tanstack/react-query';
import { registerNativeAuth } from './auth/native';
import { registerMeetings } from './meeting-routes';
import type { MeetingService } from './services/meetings';
import { meetingsOpenapi } from './meetings-openapi';
import { registerCommunity } from './community-routes';
import type { CommunityService } from './services/community';
import { registerAttendance } from './attendance-routes';
import type { AttendanceService } from './services/attendance';
export type Renderer = typeof renderPage;
export function createApp({
  service = fixtureService(),
  renderer,
  assets = { scripts: [], css: [] },
  deadlineMs = 5000,
  onCleanup,
  observe,
  places = databasePlaces(undefined, kmaWeather()),
  auth,
  meetings,
  community,
  attendance,
}: {
  service?: MeetupService;
  renderer: () => Promise<Renderer>;
  assets?: Assets;
  deadlineMs?: number;
  onCleanup?: () => void;
  observe?: (event: {
    route: string;
    method: string;
    status: number;
    durationMs: number;
    requestId: string;
  }) => void;
  places?: PlaceService;
  auth?: AuthService;
  meetings?: MeetingService;
  community?: CommunityService;
  attendance?: AttendanceService;
}) {
  const app = Fastify({ logger: false });
  app.addHook('onResponse', async (request, reply) => {
    observe?.({
      route: request.routeOptions.url ?? 'unmatched',
      method: request.method,
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      requestId: request.id,
    });
  });
  app.addHook('onSend', async (_request, reply) => {
    const hashed = /^\/assets\/[^/?]+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(_request.url);
    reply.header(
      'Cache-Control',
      hashed && reply.statusCode === 200
        ? 'public, max-age=31536000, immutable'
        : 'private, no-store',
    );
    reply.header('X-Content-Type-Options', 'nosniff');
  });
  if (community) registerCommunity(app, community, auth, renderer, assets, deadlineMs, meetings);
  if (attendance) registerAttendance(app, attendance, auth);
  registerAuthRoutes(app, auth);
  registerNativeAuth(app, auth);
  if (meetings) registerMeetings(app, meetings, auth, renderer, assets, deadlineMs);
  app.get('/account', async (request, reply) => {
    const client = createRequestClient();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      if (!reply.sent && !reply.raw.headersSent && !reply.raw.destroyed)
        reply.code(504).type('text/html').send(errorPage('응답 시간이 초과되었습니다.'));
      else reply.raw.destroy();
    }, deadlineMs);
    const cleanup = () => {
      clearTimeout(timer);
      controller.abort();
      client.clear();
      reply.raw.removeListener('close', cleanup);
      reply.raw.removeListener('finish', cleanup);
    };
    reply.raw.once('close', cleanup);
    reply.raw.once('finish', cleanup);
    try {
      const account = await currentAccount(auth, request, reply);
      const userId = account.user?.id ?? null;
      client.setQueryData(accountKey(userId), account);
      const query = request.query as {
        returnTo?: string;
        mode?: string;
        error?: string;
        passwordChanged?: string;
      };
      const render = await renderer();
      if (!controller.signal.aborted)
        await render(
          reply,
          {
            url: request.url,
            route: {
              section: 'account',
              userId,
              returnTo: accountReturnPath(query.returnTo),
              mode: query.mode === 'reset' ? 'reset' : 'login',
              callbackFailed: Boolean(query.error),
              passwordChanged: query.passwordChanged === '1',
            },
            dehydratedState: dehydrate(client),
          },
          client,
          assets,
          controller.signal,
        );
    } catch {
      if (
        !controller.signal.aborted &&
        !reply.sent &&
        !reply.raw.headersSent &&
        !reply.raw.destroyed
      )
        reply.code(503).type('text/html').send(errorPage('계정 서비스를 불러오지 못했습니다.'));
      cleanup();
    }
    return reply;
  });
  app.get('/api/v1/openapi.json', async () => (meetings ? meetingsOpenapi : openapi));
  if (!meetings)
    app.get('/api/v1/meetups/:id', async (request, reply) => {
      const id = idSchema.safeParse((request.params as { id: string }).id);
      if (!id.success)
        return reply.code(400).send({
          error: {
            code: 'INVALID_ID',
            message: '잘못된 모임 주소입니다.',
            requestId: request.id,
            retryable: false,
          },
        });
      try {
        return await service(id.data, AbortSignal.timeout(deadlineMs));
      } catch (error) {
        const status = error instanceof ServiceError ? error.status : 503;
        return reply.code(status).send({
          error: {
            code: error instanceof ServiceError ? error.code : 'UNAVAILABLE',
            message: status === 404 ? '모임을 찾을 수 없습니다.' : '모임을 불러오지 못했습니다.',
            requestId: request.id,
            retryable: status >= 500,
          },
        });
      }
    });
  const placeAPI = async (request: FastifyRequest, reply: Parameters<Renderer>[0]) => {
    const id = (request.params as { id?: string }).id;
    if (id && !placeIdSchema.safeParse(id).success)
      return reply.code(400).send({
        error: {
          code: 'INVALID_ID',
          message: '잘못된 시설 주소입니다.',
          requestId: request.id,
          retryable: false,
        },
      });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), deadlineMs);
    const cleanup = () => {
      clearTimeout(timeout);
      controller.abort();
      reply.raw.off('close', cleanup);
      reply.raw.off('finish', cleanup);
    };
    reply.raw.once('close', cleanup);
    reply.raw.once('finish', cleanup);
    try {
      const signal = controller.signal;
      if (!id) return await places.list(signal);
      if (request.routeOptions.url?.endsWith('/info')) return await places.info(id, signal);
      if (request.routeOptions.url?.endsWith('/weather'))
        return await places.weather((await places.info(id, signal)).place, signal);
      return await places.detail(id, signal);
    } catch (error) {
      const status = error instanceof ServiceError ? error.status : 503;
      return reply.code(status).send({
        error: {
          code: status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE',
          message: status === 404 ? '시설을 찾을 수 없습니다.' : '시설을 불러오지 못했습니다.',
          requestId: request.id,
          retryable: status >= 500,
        },
      });
    }
  };
  app.get('/api/v1/places', placeAPI);
  app.get('/api/v1/places/:id', placeAPI);
  app.get('/api/v1/places/:id/info', placeAPI);
  app.get('/api/v1/places/:id/weather', placeAPI);
  const page = async (request: FastifyRequest, reply: Parameters<Renderer>[0]) => {
    const isPlace = request.routeOptions.url?.startsWith('/places') ?? false;
    const rawId = (request.params as { id?: string }).id;
    const id = isPlace ? placeIdSchema.optional().safeParse(rawId) : idSchema.safeParse(rawId);

    if (!id.success)
      return reply
        .code(404)
        .type('text/html')
        .send(errorPage(isPlace ? '시설을 찾을 수 없습니다.' : '모임을 찾을 수 없습니다.'));
    const client = createRequestClient();
    const controller = new AbortController();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timer);
      controller.abort();
      client.clear();
      reply.raw.removeListener('close', cleanup);
      reply.raw.removeListener('finish', cleanup);
      onCleanup?.();
    };
    const timer = setTimeout(() => {
      if (!reply.sent && !reply.raw.headersSent && !reply.raw.destroyed)
        reply.code(504).type('text/html').send(errorPage('응답 시간이 초과되었습니다.'));
      else reply.raw.destroy();
      cleanup();
    }, deadlineMs);
    reply.raw.once('close', cleanup);
    reply.raw.once('finish', cleanup);
    try {
      const state = isPlace
        ? await loadPlaces(id.data, places, controller.signal, client)
        : await loadMeetup(id.data!, service, controller.signal, client);
      const resources: StreamResources = {};
      if (isPlace && id.data) {
        const info = client.getQueryData<PlaceInfo>(placeKey(id.data))!;
        resources.weather = deferState(
          'weather',
          places.weather(info.place, controller.signal).then((data) => {
            controller.signal.throwIfAborted();
            client.setQueryData(weatherKey(id.data!), data);
          }),
          client,
          (query) => query.queryKey[0] === 'weather',
        );
      }
      const render = await renderer();
      if (!controller.signal.aborted)
        await render(
          reply,
          {
            url: request.url,
            fixture: !meetings,
            stream: resources.weather
              ? { id: randomUUID(), slots: ['weather'], deadlineMs }
              : undefined,
            route: isPlace
              ? { section: 'places', id: id.data }
              : {
                  id: id.data!,
                  discussion: request.routeOptions.url?.endsWith('/discussion') ?? false,
                },
            dehydratedState: state,
          },
          client,
          assets,
          controller.signal,
          undefined,
          resources,
        );
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !reply.sent &&
        !reply.raw.headersSent &&
        !reply.raw.destroyed
      )
        reply
          .code(error instanceof ServiceError ? error.status : 503)
          .type('text/html')
          .send(
            errorPage(
              error instanceof ServiceError
                ? error.message
                : isPlace
                  ? '시설을 불러오지 못했습니다.'
                  : '모임을 불러오지 못했습니다.',
            ),
          );
      cleanup();
    }
    return reply;
  };
  if (!meetings) app.get('/meetups/:id', page);
  if (!community) app.get('/meetups/:id/discussion', page);
  app.get('/places', page);
  app.get('/places/:id', page);
  app.get('/', async (_request, reply) => reply.redirect('/places'));
  return app;
}
