import { afterEach, test, expect, vi } from 'vitest';
import { BridgeClient } from '../src/app/bridge';
afterEach(() => vi.useRealTimers());
test('capabilities and openMeetup correlate requestId', async () => {
  const client = new BridgeClient(async (raw) => {
    const m = raw as { requestId: string; type: string };
    return {
      version: 1,
      requestId: m.requestId,
      status: 'ok',
      result: m.type === 'capabilities' ? { openMeetup: true } : { accepted: true },
    };
  });
  expect((await client.request('capabilities')).status).toBe('ok');
  expect(
    (await client.request('openMeetup', { meetupId: '11111111-1111-4111-8111-111111111111' }))
      .status,
  ).toBe('ok');
  client.close();
});
test('close before sending makes no Native call', async () => {
  const send = vi.fn();
  const client = new BridgeClient(send);
  client.close();
  await expect(client.request('openMeetup')).rejects.toThrow('closed');
  expect(send).not.toHaveBeenCalled();
});
test('close after acceptance rejects web wait without undoing Native effect or retrying', async () => {
  let reply!: (value: unknown) => void;
  let executed = 0;
  const send = vi.fn(() => {
    executed++;
    return new Promise((resolve) => {
      reply = resolve;
    });
  });
  const client = new BridgeClient(send);
  const result = client.request('openMeetup');
  client.close();
  await expect(result).rejects.toThrow('closed');
  reply({});
  await Promise.resolve();
  expect(executed).toBe(1);
  expect(send).toHaveBeenCalledTimes(1);
});
test('timeout, bad correlation and transport failure do not retry', async () => {
  vi.useFakeTimers();
  const send = vi.fn(() => new Promise(() => {}));
  const client = new BridgeClient(send, 100);
  const result = expect(client.request('openMeetup')).rejects.toThrow('timeout');
  await vi.advanceTimersByTimeAsync(100);
  await result;
  expect(send).toHaveBeenCalledTimes(1);
  const malformed = new BridgeClient(async () => ({
    version: 1,
    requestId: '22222222-2222-4222-8222-222222222222',
    status: 'ok',
  }));
  await expect(malformed.request('capabilities')).rejects.toThrow('requestId');
  const failure = new BridgeClient(() => {
    throw new Error('failed');
  });
  await expect(failure.request('capabilities')).rejects.toThrow('transport');
});
