import { z } from 'zod';
import { idSchema } from '../contracts/meetup';
const responseSchema = z.object({
  version: z.literal(1),
  requestId: idSchema,
  status: z.enum(['ok', 'error', 'unsupported']),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type BridgeTransport = (message: unknown) => Promise<unknown>;
export class BridgeClient {
  private closed = false;
  private pending = new Set<(reason: Error) => void>();
  constructor(
    private transport: BridgeTransport,
    private timeoutMs = 3000,
  ) {}
  request(type: 'capabilities' | 'openMeetup', payload: Record<string, string> = {}) {
    if (this.closed) return Promise.reject(new Error('closed'));
    const requestId = crypto.randomUUID();
    return new Promise<z.infer<typeof responseSchema>>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.pending.delete(cancel);
      };
      const cancel = (reason: Error) => {
        finish();
        reject(reason);
      };
      const timer = setTimeout(() => cancel(new Error('timeout')), this.timeoutMs);
      this.pending.add(cancel);
      // No retries: loss of a reply says nothing about Native execution.
      try {
        this.transport({ version: 1, requestId, type, payload })
          .then((raw) => {
            const response = responseSchema.parse(raw);
            if (response.requestId !== requestId) throw new Error('requestId');
            if (response.status === 'ok') {
              const result =
                type === 'capabilities'
                  ? z.object({ openMeetup: z.boolean() })
                  : z.object({ accepted: z.literal(true) });
              result.parse(response.result);
            }
            finish();
            resolve(response);
          })
          .catch(cancel);
      } catch {
        cancel(new Error('transport'));
      }
    });
  }
  close() {
    this.closed = true;
    for (const cancel of this.pending) cancel(new Error('closed'));
  }
}
declare global {
  interface Window {
    webkit?: { messageHandlers?: { cmonYo?: { postMessage: BridgeTransport } } };
  }
}
export function nativeBridge() {
  const handler = window.webkit?.messageHandlers?.cmonYo;
  return handler ? new BridgeClient((message) => handler.postMessage(message)) : null;
}
