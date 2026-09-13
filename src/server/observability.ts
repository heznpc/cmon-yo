import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import { clientEventSchema, commandAction } from '../contracts/telemetry';
type Detail = {
  event: string;
  outcome?: string;
  phase?: string;
  status?: number;
  commandId?: string;
  action?: string;
  client?: unknown;
};
export type Observation = Detail & { requestId: string; route: string; method: string };
type Emit = (event: Detail) => void;
declare module 'fastify' {
  interface FastifyRequest {
    observe: Emit;
  }
}
const context = new AsyncLocalStorage<Emit>();
export function observeWeather(outcome: string) {
  context.getStore()?.({ event: 'weather', outcome });
}
export function observeDeferred(slot: string) {
  context.getStore()?.({ event: 'deferred_failed', phase: slot });
}
export function installObservability(
  app: FastifyInstance,
  observer?: (event: Observation) => void,
) {
  app.decorateRequest('observe', () => {});
  app.addHook('onRequest', (request, reply, done) => {
    request.observe = (event) => {
      try {
        observer?.({
          ...event,
          requestId: request.id,
          route: request.routeOptions.url ?? 'unmatched',
          method: request.method,
        });
      } catch {
        /* Observability cannot change command or response semantics. */
      }
    };
    reply.header('X-Request-ID', request.id);
    let finished = false;
    reply.raw.once('finish', () => {
      finished = true;
    });
    reply.raw.once('close', () => {
      if (!finished)
        request.observe({
          event: 'response_interrupted',
          phase: reply.raw.headersSent ? 'stream' : 'before_headers',
        });
    });
    context.run(request.observe, done);
  });
  app.addHook('onError', async (request, _reply, error) => {
    // Fastify has not applied the error status to reply yet at this hook.
    request.observe({ event: 'server_error', status: error.statusCode ?? 500 });
  });
  app.addHook('onResponse', async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (typeof key === 'string' && /^[0-9a-f-]{36}$/i.test(key))
      request.observe({
        event: 'command_result',
        action: commandAction(request.body),
        commandId: key,
        status: reply.statusCode,
        outcome: reply.statusCode < 400 ? 'succeeded' : 'failed',
      });
  });
  let start = Date.now(),
    accepted = 0;
  app.post('/api/v1/telemetry', { bodyLimit: 2048 }, async (request, reply) => {
    // Browser reports are untrusted diagnostics. Same-origin only, fixed fields,
    // bounded size and a bounded process-wide intake rate; no private payloads.
    const origin = request.headers.origin;
    if (
      origin !== `${request.protocol}://${request.host}` ||
      request.headers['sec-fetch-site'] === 'cross-site'
    )
      return reply.code(403).send();
    if (Date.now() - start > 60000) {
      start = Date.now();
      accepted = 0;
    }
    if (accepted++ >= 300) return reply.code(429).send();
    const parsed = clientEventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send();
    request.observe({ event: 'client_report', client: parsed.data });
    return reply.code(204).send();
  });
}
