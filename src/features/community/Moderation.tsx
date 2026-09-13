import { useState } from 'react';
import type { CommunityCommand } from '../../contracts/community';
export function Confirm({
  label,
  disabled,
  run,
}: {
  label: string;
  disabled: boolean;
  run: () => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <span>
      {label}하시겠습니까?{' '}
      <button
        disabled={disabled}
        onClick={() =>
          void run().then((ok) => {
            if (ok) setConfirm(false);
          })
        }
      >
        {label} 확정
      </button>
      <button onClick={() => setConfirm(false)}>닫기</button>
    </span>
  ) : (
    <button disabled={disabled} onClick={() => setConfirm(true)}>
      {label}
    </button>
  );
}
export function Moderation({
  target,
  id,
  authorId,
  disabled,
  mutate,
}: {
  target: 'post' | 'comment';
  id: string;
  authorId: string | null;
  disabled: boolean;
  mutate: (i: CommunityCommand) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  return (
    <details>
      <summary>신고·차단</summary>
      <label>
        신고 사유
        <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button
        disabled={disabled || !reason.trim()}
        onClick={() => void mutate({ action: 'report', target, id, reason })}
      >
        신고 접수
      </button>
      {authorId ? (
        <Confirm
          label="작성자 차단"
          disabled={disabled}
          run={() => mutate({ action: 'block', id: authorId, blocked: true })}
        />
      ) : null}
    </details>
  );
}
