import { errorPage } from './error-page';
import Fastify, { type FastifyRequest } from 'fastify';
import { idSchema } from '../contracts/meetup';
import { fixtureService, ServiceError, type MeetupService } from './services/meetup';
import { createRequestClient, loadMeetup } from './loaders/meetup';
import type { renderPage, Assets } from './render';
export type Renderer = typeof renderPage;
export function createApp({
  service = fixtureService(),
  renderer,
  assets = { scripts: [], css: [] },
  deadlineMs = 5000,
  onCleanup,
}: {
  service?: MeetupService;
  renderer: () => Promise<Renderer>;
  assets?: Assets;
  deadlineMs?: number;
  onCleanup?: () => void;
}) {
  const app = Fastify({ logger: false });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });
  app.get('/api/v1/meetups/:id', async (request, reply) => {
    const id = idSchema.safeParse((request.params as { id: string }).id);
    if (!id.success)
      return reply
        .code(400)
        .send({
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
      return reply
        .code(status)
        .send({
          error: {
            code: error instanceof ServiceError ? error.code : 'UNAVAILABLE',
            message: status === 404 ? '모임을 찾을 수 없습니다.' : '모임을 불러오지 못했습니다.',
            requestId: request.id,
            retryable: status >= 500,
          },
        });
    }
  });
  const page = async (request: FastifyRequest, reply: Parameters<Renderer>[0]) => {
    const id = idSchema.safeParse((request.params as { id: string }).id);

    if (!id.success)
      return reply.code(404).type('text/html').send(errorPage('모임을 찾을 수 없습니다.'));
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
      if (!reply.sent)
        reply.code(504).type('text/html').send(errorPage('응답 시간이 초과되었습니다.'));
      else reply.raw.destroy();
      cleanup();
    }, deadlineMs);
    reply.raw.once('close', cleanup);
    reply.raw.once('finish', cleanup);
    try {
      const state = await loadMeetup(id.data, service, controller.signal, client);
      const render = await renderer();
      if (!controller.signal.aborted)
        render(
          reply,
          {
            route: {
              id: id.data,
              discussion: request.routeOptions.url?.endsWith('/discussion') ?? false,
            },
            dehydratedState: state,
          },
          client,
          assets,
          controller.signal,
        );
    } catch (error) {
      if (!controller.signal.aborted && !reply.sent)
        reply
          .code(error instanceof ServiceError ? error.status : 503)
          .type('text/html')
          .send(
            errorPage(
              error instanceof ServiceError ? error.message : '모임을 불러오지 못했습니다.',
            ),
          );
      cleanup();
    }
    return reply;
  };
  app.get('/meetups/:id', page);
  app.get('/meetups/:id/discussion', page);
  app.get('/', async (_request, reply) =>
    reply.redirect('/meetups/11111111-1111-4111-8111-111111111111'),
  );
  return app;
}
