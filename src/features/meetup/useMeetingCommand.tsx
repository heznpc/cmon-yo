import { z } from 'zod';
import { useCommand } from '../recovery/useCommand';
import { meetingRequest } from '../../api/meetings';
import { communityResultSchema } from '../../contracts/community';
import { AppLink } from '../../app/navigation';
import * as css from './meetup.css';
const inputSchema = z.object({
  path: z.string().regex(/^\/api\/v1\/meetups(?:\/[0-9a-f-]{36})?$/),
  method: z.enum(['POST', 'PATCH']),
  body: z.record(z.string(), z.unknown()),
});
export function useMeetingCommand(
  userId: string | null,
  scope: string,
  ready: boolean,
  onSuccess: (id: string) => Promise<void>,
) {
  const command = useCommand({
    userId,
    scope: 'meeting:' + scope,
    ready,
    schema: inputSchema,
    lookup: '/api/v1/me/commands/',
    execute: (input, key, signal) =>
      meetingRequest(input.path, communityResultSchema, {
        method: input.method,
        signal,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
          'X-Cmon-User': userId!,
        },
        body: JSON.stringify(input.body),
      }),
    completed: async (_input, _key, id) => onSuccess(id),
  });
  return {
    ...command,
    error: command.message,
    setError: command.setMessage,
    run: (path: string, method: string, body: object) =>
      command.run(inputSchema.parse({ path, method, body })),
    feedback: (
      <>
        <p role="alert">{command.message}</p>
        <p role="status">{command.pending ? '처리 중…' : ''}</p>
        {command.unknown ? (
          <div className={css.actions}>
            <button disabled={command.pending || !ready} onClick={() => void command.inspect()}>
              요청 처리 상태 확인
            </button>
            <button disabled={command.pending || !ready} onClick={() => void command.retry()}>
              같은 요청 다시 보내기
            </button>
            <AppLink href="/account/meetups">내 모임에서 확인</AppLink>
          </div>
        ) : null}
      </>
    ),
  };
}
