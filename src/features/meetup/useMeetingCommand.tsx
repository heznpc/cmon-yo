import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { idSchema } from '../../contracts/meetup';
import { meetingRequest, MeetingRequestError } from '../../api/meetings';
import { AppLink } from '../../app/navigation';
import * as css from './meetup.css';
export function useMeetingCommand(userId: string | null, onSuccess: (id: string) => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [unknown, setUnknown] = useState<{
    key: string;
    path: string;
    method: string;
    body: object;
  } | null>(null);
  const alive = useRef(true);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function send(command: NonNullable<typeof unknown>) {
    if (pending || !userId) return;
    setPending(true);
    setError('');
    try {
      const result = await meetingRequest(command.path, z.object({ id: idSchema }), {
        method: command.method,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': command.key,
          'X-Cmon-User': userId,
        },
        body: JSON.stringify(command.body),
      });
      if (!alive.current) return;
      setUnknown(null);
      await onSuccess(result.id);
    } catch (e) {
      if (!alive.current) return;
      const uncertain = !(e instanceof MeetingRequestError) || e.status >= 500;
      setUnknown(uncertain ? command : null);
      setError(
        uncertain
          ? '응답을 확인하지 못했습니다. 처리되었을 수 있으니 현재 상태를 확인해 주세요.'
          : e.message,
      );
    } finally {
      if (alive.current) setPending(false);
    }
  }
  async function inspect() {
    if (!unknown || pending) return;
    setPending(true);
    try {
      const result = await meetingRequest(
        `/api/v1/me/commands/${unknown.key}`,
        z.object({ id: idSchema.nullable() }),
      );
      if (!alive.current) return;
      if (result.id) {
        setUnknown(null);
        setError('');
        await onSuccess(result.id);
      } else
        setError('아직 처리 결과가 없습니다. 같은 요청을 다시 보내거나 내 모임에서 확인해 주세요.');
    } catch {
      if (alive.current) setError('현재 상태 조회에도 실패했습니다. 연결 후 다시 확인해 주세요.');
    } finally {
      if (alive.current) setPending(false);
    }
  }
  return {
    pending,
    unknown,
    error,
    setError,
    run: (path: string, method: string, body: object) =>
      send({ path, method, body, key: crypto.randomUUID() }),
    feedback: (
      <>
        <p role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
        <p role="status">{pending ? '처리 중…' : ''}</p>
        {unknown ? (
          <div className={css.actions}>
            <button disabled={pending} onClick={() => void inspect()}>
              요청 처리 상태 확인
            </button>
            <button disabled={pending} onClick={() => void send(unknown)}>
              같은 요청 다시 보내기
            </button>
            <AppLink href="/account/meetups">내 모임에서 확인</AppLink>
          </div>
        ) : null}
      </>
    ),
  };
}
