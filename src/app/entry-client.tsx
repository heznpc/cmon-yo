import { hydrateRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { App, type InitialState } from './App';
const state: InitialState = JSON.parse(document.getElementById('initial-state')!.textContent!);
const client = new QueryClient();
hydrateRoot(document.getElementById('root')!, <App client={client} state={state} />, {
  onRecoverableError() {
    console.error('Hydration recovery required');
  },
});
