import { reportClientEvent } from '../api/telemetry';
window.addEventListener('error', () => reportClientEvent({ event: 'browser_error' }));
window.addEventListener('unhandledrejection', () =>
  reportClientEvent({ event: 'unhandled_rejection' }),
);
import { hydrateRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { App, prepareInitialRoute, type InitialState } from './App';
import { BrowserRouter } from 'react-router';
import { receiveStream } from './stream';
try {
  const state: InitialState = JSON.parse(document.getElementById('initial-state')!.textContent!);
  const resources = state.stream ? receiveStream(state.stream) : {};
  await prepareInitialRoute(state);
  const client = new QueryClient();
  hydrateRoot(
  document.getElementById('root')!,
  <BrowserRouter>
    <App client={client} state={state} resources={resources} />
  </BrowserRouter>,
  {
    onRecoverableError() {
      console.error('Hydration recovery required');
      reportClientEvent({ event: 'hydration_error' });
    },
  },
  );
} catch {
  reportClientEvent({ event: 'browser_error' });
  // Keep the readable server document when a deploy or connection failure
  // prevents an entry chunk from loading. Never replace it with a blank root.
  const notice = document.createElement('section');
  notice.setAttribute('role', 'alert');
  const message = document.createElement('p');
  message.textContent = '화면 기능을 준비하지 못했습니다. 연결을 확인하고 다시 불러와 주세요.';
  const retry = document.createElement('button');
  retry.textContent = '화면 다시 불러오기';
  retry.addEventListener('click', () => window.location.reload());
  notice.append(message, retry);
  document.body.prepend(notice);
}
