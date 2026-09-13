import { errorPage } from './error-page';
import { renderToPipeableStream } from 'react-dom/server';
import type { ReactNode } from 'react';
import { PassThrough } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { App, initialURL, prepareInitialRoute, type InitialState } from '../app/App';
import type { QueryClient } from '@tanstack/react-query';
export type Assets = { scripts: string[]; css: string[]; preloads?: string[] };
import { serialize } from '../app/serialize';
export { serialize } from '../app/serialize';
import { StaticRouter } from 'react-router';
import { streamBootstrap, type StreamResources } from '../app/stream';
export async function renderPage(
  reply: FastifyReply,
  state: InitialState,
  client: QueryClient,
  assets: Assets,
  signal: AbortSignal,
  content?: ReactNode,
  resources?: StreamResources,
) {
  await prepareInitialRoute(state);
  if (signal.aborted) return;
  const stream = new PassThrough();
  let renderFailed = false;
  const stop = () => {
    rendering.abort();
    stream.destroy();
  };
  const clean = () => signal.removeEventListener('abort', stop);
  stream.once('close', clean);
  stream.once('end', clean);
  const rendering = renderToPipeableStream(
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        {state.stream ? (
          <script dangerouslySetInnerHTML={{ __html: streamBootstrap(state.stream) }} />
        ) : null}
        <title>{`C'mon Yo! · ${'section' in state.route ? (state.route.section === 'account' ? '내 계정' : state.route.section === 'meetings' ? '모임' : '시설') : '모임'}`}</title>
        {assets.preloads?.map((href) => (
          <link key={href} rel="modulepreload" href={href} />
        ))}
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>
        <div id="root">
          {content ?? (
            <StaticRouter location={initialURL(state)}>
              <App state={state} client={client} resources={resources} />
            </StaticRouter>
          )}
        </div>
        <script
          id="initial-state"
          type="application/json"
          dangerouslySetInnerHTML={{ __html: serialize(state) }}
        />
      </body>
    </html>,
    {
      // React emits async module bootstraps after the shell (including the
      // initial JSON), so hydration can start before deferred HTML finishes.
      bootstrapModules: assets.scripts,
      onShellReady() {
        if (signal.aborted) return;
        reply
          .code(renderFailed ? 500 : 200)
          .type('text/html; charset=utf-8')
          .send(stream);
        rendering.pipe(stream);
      },
      onShellError() {
        clean();
        stream.destroy();
        if (!reply.sent && !reply.raw.headersSent && !reply.raw.destroyed && !signal.aborted)
          reply.code(500).type('text/html').send(errorPage('화면을 표시하지 못했습니다.'));
      },
      onError() {
        renderFailed = true;
        reply.log.error({ event: 'ssr_render_error' });
      },
    },
  );
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
}
