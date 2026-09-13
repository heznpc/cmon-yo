import { errorPage } from './error-page';
import { renderToPipeableStream } from 'react-dom/server';
import type { ReactNode } from 'react';
import { PassThrough } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { App, type InitialState } from '../app/App';
import type { QueryClient } from '@tanstack/react-query';
export type Assets = { scripts: string[]; css: string[] };
export function serialize(value: unknown) {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
export function renderPage(
  reply: FastifyReply,
  state: InitialState,
  client: QueryClient,
  assets: Assets,
  signal: AbortSignal,
  content?: ReactNode,
) {
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
        <title>C'mon Yo! · 모임</title>
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>
        <div id="root">{content ?? <App state={state} client={client} />}</div>
        <script
          id="initial-state"
          type="application/json"
          dangerouslySetInnerHTML={{ __html: serialize(state) }}
        />
        {assets.scripts.map((src) => (
          <script key={src} type="module" src={src} />
        ))}
      </body>
    </html>,
    {
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
        if (!reply.sent && !signal.aborted)
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
