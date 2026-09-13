import { reportClientEvent } from '../../api/telemetry';
import { commandAction, type ClientEvent } from '../../contracts/telemetry';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { meetingRequest, MeetingRequestError } from '../../api/meetings';
import { communityResultSchema } from '../../contracts/community';
import { readRecovery, writeRecovery, removeRecovery } from './storage';

type Command<I> = { key: string; input: I | null };
// Shared by community, meetings and attendance. Only explicit retry resends a
// mutation; reload/online recovery performs the authenticated result GET.
export function useCommand<I>({
  userId,
  scope,
  ready = true,
  schema,
  execute,
  lookup,
  completed,
  accepted,
  persistInput = (input) => input,
}: {
  userId: string | null;
  scope: string;
  ready?: boolean;
  schema: z.ZodType<I>;
  execute: (input: I, key: string, signal: AbortSignal) => Promise<{ id: string | null }>;
  lookup: string;
  completed: (input: I | null, key: string, id: string, current: () => boolean) => Promise<void>;
  accepted?: (input: I | null) => void;
  persistInput?: (input: I) => I | null;
}) {
  const [unknown, setUnknown] = useState<Command<I> | null>(null);
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const record = useRef<Command<I> | null>(null),
    busy = useRef(false),
    alive = useRef(false);
  const active = useRef<AbortController | null>(null);
  const latest = useRef({ execute, completed, accepted, ready, persistInput });
  latest.current = { execute, completed, accepted, ready, persistInput };
  const validator = useRef(schema);
  const storageScope = 'command:' + scope;
  function report(outcome: ClientEvent['outcome'], key?: string) {
    const area = scope.split(':')[0] as 'community' | 'meeting' | 'attendance';
    reportClientEvent({
      event: 'command',
      area,
      action: commandAction(record.current?.input),
      outcome,
      ...(key ? { commandId: key } : {}),
    });
  }
  useEffect(() => {
    alive.current = true;
    try {
      record.current = userId
        ? readRecovery(
            userId,
            storageScope,
            z.object({ key: z.uuid(), input: validator.current.nullable() }),
          )
        : null;
      setUnknown(record.current);
      if (record.current)
        setMessage('응답을 받지 못한 요청을 복구했습니다. 저장 결과를 확인해 주세요.');
    } catch {
      setMessage('요청 기록을 읽지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');
    }
    setHydrated(true);
    return () => {
      alive.current = false;
      active.current?.abort();
    };
  }, [userId, storageScope]);
  function withRecordLock<T>(work: () => T): Promise<T> {
    return navigator.locks
      ? navigator.locks.request('cmon:' + userId + ':' + scope, work)
      : Promise.resolve().then(work);
  }
  async function clear(command: Command<I>, confirmed = false) {
    if (userId)
      await withRecordLock(() => {
        const stored = readRecovery(
          userId,
          storageScope,
          z.object({ key: z.uuid(), input: validator.current.nullable() }),
        );
        // A different tab may already have acknowledged this command and
        // reserved a newer one. Only its matching receipt can remove a record.
        if (stored?.key !== command.key) return;
        if (confirmed) latest.current.accepted?.(command.input);
        removeRecovery(userId, storageScope);
      });
    record.current = null;
    setUnknown(null);
  }
  async function accept(command: Command<I>, id: string) {
    await clear(command, true);
    setMessage('저장 결과를 확인했습니다.');
    // A successful command stays successful even if refreshing the view fails.
    try {
      await latest.current.completed(command.input, command.key, id, () => alive.current);
      if (alive.current) setMessage('');
    } catch {
      if (alive.current) setMessage('저장했습니다. 화면의 현재 상태를 다시 조회해 주세요.');
    }
  }
  async function send(command: Command<I>, retry: boolean) {
    if (
      !userId ||
      !latest.current.ready ||
      !hydrated ||
      busy.current ||
      (!retry && record.current) ||
      !command.input
    )
      return false;
    busy.current = true;
    setPending(true);
    setMessage('');
    active.current = new AbortController();
    try {
      const reserve = () => {
        const prior = readRecovery(
          userId,
          storageScope,
          z.object({ key: z.uuid(), input: validator.current.nullable() }),
        );
        if (prior && prior.key !== command.key) return prior;
        writeRecovery(userId, storageScope, {
          ...command,
          input: latest.current.persistInput(command.input!),
        });
        return null;
      };
      // Reserve the target across tabs before fetch; never replace an unresolved
      // request with a fresh UUID. Web Locks also covers simultaneous clicks.
      const prior = await withRecordLock(reserve);
      if (prior) {
        record.current = prior;
        setUnknown(prior);
        busy.current = false;
        setPending(false);
        setMessage('이 작성 대상에 미확인 요청이 있습니다. 저장 결과를 먼저 확인해 주세요.');
        return false;
      }
      if (!alive.current || !latest.current.ready) {
        busy.current = false;
        setPending(false);
        return false;
      }
    } catch {
      report('storage_failed', command.key);
      busy.current = false;
      setPending(false);
      setMessage(
        '요청 번호를 보관하지 못해 전송하지 않았습니다. 브라우저 저장 공간을 확인해 주세요.',
      );
      return false;
    }
    record.current = command;
    setUnknown(command);
    report(retry ? 'retried' : 'sent', command.key);
    try {
      const result = await latest.current.execute(
        command.input,
        command.key,
        active.current.signal,
      );
      if (!alive.current || !latest.current.ready) return false;
      if (!result.id) throw new Error('Missing receipt');
      report('succeeded', command.key);
      await accept(command, result.id);
      return true;
    } catch (error) {
      if (!alive.current || !latest.current.ready) return false;
      const uncertain =
        !(error instanceof MeetingRequestError) ||
        error.status >= 500 ||
        error.code === 'COMMAND_CONFLICT';
      report(uncertain ? 'unknown' : 'rejected', command.key);
      if (!uncertain) {
        try {
          await clear(command);
        } catch {
          setMessage(
            '요청은 거절됐지만 기록을 정리하지 못했습니다. 저장 결과를 다시 확인해 주세요.',
          );
          return false;
        }
      }
      setMessage(
        uncertain ? '응답을 확인하지 못했습니다. 저장 결과를 먼저 확인해 주세요.' : error.message,
      );
      return false;
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }
  async function inspect() {
    const command = record.current;
    if (!command || !userId || !latest.current.ready || busy.current) return;
    busy.current = true;
    setPending(true);
    active.current = new AbortController();
    try {
      const result = await meetingRequest(lookup + command.key, communityResultSchema, {
        signal: active.current.signal,
        headers: { 'X-Cmon-User': userId },
      });
      if (!alive.current) return;
      if (result.id) {
        report('recovered', command.key);
        await accept(command, result.id);
      } else {
        report('not_found', command.key);
        setMessage(
          '아직 저장 결과가 없습니다. 늦게 도착할 수 있으므로 같은 요청 번호를 유지합니다.',
        );
      }
    } catch {
      report('lookup_failed', command.key);
      if (alive.current) setMessage('결과 조회에 실패했습니다. 연결 후 다시 확인해 주세요.');
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }
  const inspectRef = useRef(inspect);
  inspectRef.current = inspect;
  useEffect(() => {
    if (!hydrated || !ready) return;
    void inspectRef.current();
    const online = () => void inspectRef.current();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [hydrated, ready]);
  return {
    unknown,
    pending: pending || !hydrated,
    message,
    setMessage,
    run: (input: I) => send({ key: crypto.randomUUID(), input }, false),
    retry: () => (record.current ? send(record.current, true) : Promise.resolve(false)),
    inspect,
  };
}
