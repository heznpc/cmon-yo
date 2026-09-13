import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { communityKey, commentListSchema, type CommunityCommand } from '../../contracts/community';
import { meetingRequest } from '../../api/meetings';
import { useDraft } from '../recovery/useDraft';
import { form } from '../account/account.css';
import { Confirm, Moderation } from './Moderation';
const commentDraftSchema = z.object({ body: z.string().max(2000) });
export function Comments({
  receipt,
  parent,
  id,
  userId,
  ready,
  disabled,
  mutate,
}: {
  receipt: { key: string; body: string } | null;
  parent: 'post' | 'meetup';
  id: string;
  userId: string | null;
  ready: boolean;
  disabled: boolean;
  mutate: (i: CommunityCommand) => Promise<boolean>;
}) {
  const bodyId = `comment-body:${parent}:${id}`;
  const draft = useDraft(
    userId ?? 'guest',
    `draft:comment:${parent}:${id}`,
    { body: '' },
    commentDraftSchema,
  );
  const { body } = draft.value;
  const [page, setPage] = useState(0),
    [cursor, setCursor] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (receipt && body.trim() === receipt.body.trim()) draft.saved();
  }, [receipt]);
  const q = useQuery({
    queryKey: communityKey(userId, 'comments', parent, id, cursor ?? page),
    queryFn: ({ signal }) =>
      meetingRequest(
        `/api/v1/${parent === 'post' ? 'posts' : 'meetups'}/${id}/comments?page=${page}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
        commentListSchema,
        { signal, headers: { 'X-Cmon-User': userId ?? 'guest' } },
      ),
    enabled: ready,
    staleTime: 30000,
    retry: false,
  });
  return (
    <section>
      <h2>댓글</h2>
      {q.error ? (
        <p role="alert">
          댓글을 불러오지 못했습니다.
          <button onClick={() => void q.refetch()}>댓글 다시 조회</button>
        </p>
      ) : (
        <ul>
          {q.data?.comments.map((c) => (
            <li key={c.id}>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {c.authorName}: {c.body}
              </p>
              {userId === c.authorId ? (
                <Confirm
                  label="댓글 삭제"
                  disabled={disabled}
                  run={() =>
                    mutate({ action: 'deleteComment', id: c.id, expectedVersion: c.version })
                  }
                />
              ) : userId ? (
                <Moderation
                  target="comment"
                  id={c.id}
                  authorId={c.authorId}
                  disabled={disabled}
                  mutate={mutate}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page > 0 ? (
        <button
          onClick={() => {
            setPage(0);
            setCursor(undefined);
          }}
        >
          이전 댓글
        </button>
      ) : null}
      {q.data?.nextPage != null ? (
        <button
          onClick={() => {
            setPage(q.data!.nextPage!);
            setCursor(q.data!.nextCursor!);
          }}
        >
          다음 댓글
        </button>
      ) : null}
      {userId ? (
        <form
          className={form}
          onSubmit={(e) => {
            e.preventDefault();
            void mutate({ action: 'comment', parent, id, body }).then((ok) => {
              if (ok) draft.saved();
            });
          }}
        >
          <label htmlFor={bodyId}>댓글 내용</label>
          <textarea
            id={bodyId}
            disabled={disabled}
            required
            maxLength={2000}
            value={body}
            onChange={(e) => draft.update({ body: e.target.value })}
          />
          <button disabled={disabled || !draft.hydrated || !body.trim()}>댓글 등록</button>
          <button type="button" disabled={disabled} onClick={draft.discard}>
            댓글 초안 폐기
          </button>
          {draft.message ? <p role="status">{draft.message}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
