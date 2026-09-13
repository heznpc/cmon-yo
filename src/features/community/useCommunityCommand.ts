import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  communityCommandSchema,
  communityResultSchema,
  communityKey,
  type CommunityCommand,
} from '../../contracts/community';
import { meetingRequest } from '../../api/meetings';
import { useCommand } from '../recovery/useCommand';
import { removeRecovery } from '../recovery/storage';
import { postDraftScope } from './postDraft';
import type { CommunityRoute } from './CommunityPage';
export function useCommunityCommand(
  route: CommunityRoute,
  ready: boolean,
  closeEditor: () => void,
) {
  const { userId, id, mode } = route,
    nav = useNavigate(),
    client = useQueryClient();
  const [notice, setNotice] = useState(''),
    [receipt, setReceipt] = useState<{ key: string; body: string } | null>(null);
  async function completed(
    input: CommunityCommand,
    key: string,
    resultId: string | null,
    current: () => boolean,
  ) {
    // Clear accepted input before any asynchronous view refresh. Navigation may
    // unmount the page while invalidation is pending.
    if (input.action === 'create' || input.action === 'edit' || input.action === 'delete')
      removeRecovery(userId!, postDraftScope(input.action === 'create' ? undefined : input.id));
    if (input.action === 'comment')
      removeRecovery(userId!, `draft:comment:${input.parent}:${input.id}`);
    const affected: (readonly unknown[])[] = [];
    if (input.action === 'create' || input.action === 'edit' || input.action === 'delete') {
      affected.push(communityKey(userId, 'list'));
      if (input.action !== 'create') affected.push(communityKey(userId, 'post', input.id));
    } else if (input.action === 'comment') {
      affected.push(communityKey(userId, 'comments', input.parent, input.id));
    } else if (input.action === 'deleteComment') {
      affected.push(communityKey(userId, 'comments', mode === 'detail' ? 'post' : 'meetup', id));
    } else if (input.action === 'block' || input.action === 'profile') {
      // Visibility and author names affect cached public content for this viewer.
      for (const part of ['list', 'post', 'comments']) affected.push(communityKey(userId, part));
      affected.push(communityKey(userId, input.action === 'block' ? 'blocks' : 'profile'));
    }
    await Promise.all(affected.map((queryKey) => client.invalidateQueries({ queryKey })));
    if (!current()) return;
    setNotice(
      input.action === 'report' ? '신고를 접수했습니다. 운영 처리 전입니다.' : '저장했습니다.',
    );
    if (input.action === 'comment') setReceipt({ key, body: input.body });
    if (input.action === 'create') nav('/community/' + resultId);
    if (input.action === 'delete' || (input.action === 'block' && input.blocked)) nav('/community');
    if (input.action === 'edit') closeEditor();
    if (input.action === 'profile')
      await client.invalidateQueries({ queryKey: ['private', userId, 'account'] });
  }

  const command = useCommand({
    userId,
    ready,
    scope: `community:${mode}:${id ?? ''}`,
    schema: communityCommandSchema,
    lookup: '/api/v1/me/community-commands/',
    execute: (input, key, signal) =>
      meetingRequest('/api/v1/community/commands', communityResultSchema, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Cmon-User': userId!,
          'Idempotency-Key': key,
        },
        body: JSON.stringify(input),
      }),
    completed: async (input, key, resultId, current) => {
      if (input) await completed(input, key, resultId, current);
    },
  });
  return { ...command, notice: command.message || notice, receipt };
}
