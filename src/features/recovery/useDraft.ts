import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { readRecovery, writeRecovery, removeRecovery } from './storage';

export function useDraft<T>(userId: string, scope: string, initial: T, schema: z.ZodType<T>) {
  const [value, setValue] = useState(initial);
  const [hydrated, setHydrated] = useState(false);
  const [message, setMessage] = useState('');
  const defaults = useRef(initial),
    validator = useRef(schema);
  useEffect(() => {
    // AccountBoundary establishes the owner before enabling any input.
    try {
      const saved = readRecovery(userId, scope, validator.current);
      if (saved) {
        setValue(saved);
        setMessage('이 브라우저에 저장한 초안을 복구했습니다.');
      }
    } catch {
      setMessage('임시 저장을 사용할 수 없습니다. 화면을 떠나기 전에 내용을 복사해 주세요.');
    }
    setHydrated(true);
  }, [userId, scope]);
  function update(next: T) {
    setValue(next);
    try {
      writeRecovery(userId, scope, next);
      setMessage('이 브라우저에 임시 저장했습니다.');
    } catch {
      setMessage('임시 저장에 실패했습니다. 화면을 떠나기 전에 내용을 복사해 주세요.');
    }
  }
  function clear(message: string) {
    try {
      removeRecovery(userId, scope);
      setValue(defaults.current);
      setMessage(message);
    } catch {
      setMessage('초안을 지우지 못했습니다. 다시 시도해 주세요.');
    }
  }
  return {
    value,
    update,
    hydrated,
    message,
    discard: () => clear('초안을 폐기했습니다.'),
    // The command receipt owns persistent cleanup. An old component's callback
    // must not remove input another tab has written since that receipt.
    saved: () => {
      setValue(defaults.current);
      setMessage('');
    },
  };
}
