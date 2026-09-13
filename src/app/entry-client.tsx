import { hydrateRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { App, prepareInitialRoute, type InitialState } from './App';
import { BrowserRouter } from 'react-router';
import { receiveStream } from './stream';
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
    },
  },
);
