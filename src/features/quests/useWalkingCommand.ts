import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../api/http';
import { commandResultSchema } from '../../contracts/command';
import { walkingCommandSchema, walkingKey, type WalkingCommand } from '../../contracts/walking';
import { useCommand } from '../recovery/useCommand';

export type WalkingUICommand = Exclude<WalkingCommand, { action: 'bindHealth' | 'syncHealth' }>;
// Restored browser commands obey the same boundary as newly submitted actions.
const browserCommandSchema = walkingCommandSchema.refine(
  (input) => input.action !== 'bindHealth' && input.action !== 'syncHealth',
);

export function useWalkingCommand(userId: string | null, ready: boolean) {
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const command = useCommand({
    userId,
    ready,
    scope: 'quests:dashboard',
    schema: browserCommandSchema,
    lookup: '/api/v1/me/walking-commands/',
    execute: (input, key, signal) =>
      apiRequest('/api/v1/walking/commands', commandResultSchema, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Cmon-User': userId!,
          'Idempotency-Key': key,
        },
        body: JSON.stringify(input),
      }),
    completed: async (input, _key, _id, current) => {
      await client.invalidateQueries({ queryKey: walkingKey(userId) });
      if (current())
        setNotice(
          input?.action === 'redeemBadge'
            ? '배지를 교환했습니다. 포인트 내역에서 사용한 포인트를 확인할 수 있습니다.'
            : input?.action === 'claimDaily' || input?.action === 'claimStage'
              ? '포인트를 받았습니다.'
              : '원정 상태를 저장했습니다.',
        );
    },
  });
  return {
    ...command,
    notice: command.message || notice,
    run: (input: WalkingUICommand) => {
      setNotice('');
      const parsed = browserCommandSchema.safeParse(input);
      if (!parsed.success) {
        command.setMessage('원정 이름·초대 코드·선택한 시설을 확인해 주세요.');
        return Promise.resolve(false);
      }
      return command.run(parsed.data);
    },
  };
}
