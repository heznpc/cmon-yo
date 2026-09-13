import type { ClientEvent } from '../contracts/telemetry';
let remaining = 30;
export function reportClientEvent(event: ClientEvent) {
  if (typeof document === 'undefined' || remaining-- <= 0) return;
  const pageRequestId = document.querySelector<HTMLMetaElement>(
    'meta[name="cmon-request-id"]',
  )?.content;
  // Do not collect input, account identifiers, URLs, credentials, stack or error text.
  void fetch('/api/v1/telemetry', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...event, ...(pageRequestId ? { pageRequestId } : {}) }),
  }).catch(() => {});
}
