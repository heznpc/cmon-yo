import { reportClientEvent } from './telemetry';
import type { z } from 'zod';
export class MeetingRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function meetingRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const requestId = crypto.randomUUID(),
    headers = new Headers(options.headers);
  headers.set('X-Request-ID', requestId);
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  } catch (error) {
    if (!options.signal?.aborted)
      reportClientEvent({ event: 'request_failed', requestId, status: 0 });
    throw error;
  }
  if (!response.ok)
    reportClientEvent({ event: 'request_failed', requestId, status: response.status });
  const body: unknown = await response.json();
  if (!response.ok) {
    const code =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object' &&
      'code' in body.error
        ? String(body.error.code)
        : 'UNAVAILABLE';
    const messages: Record<string, string> = {
      CHECKIN_TIME: '현장 확인 가능한 시간이 아닙니다.',
      STALE_POSITION: '오래된 위치입니다. 다시 위치를 확인해 주세요.',
      INACCURATE_POSITION: '위치 정확도가 부족합니다. 다시 시도하거나 수동 확인을 요청해 주세요.',
      OUTSIDE_PLACE: '약속 장소 근처의 위치가 아닙니다. 수동 확인을 요청할 수 있습니다.',
      REVIEW_TIME: '주최자 확인 기한이 지났습니다.',
      REVIEW_STATE: '현재 처리할 수 있는 요청이 아닙니다.',
      ALREADY_CONFIRMED: '이미 현장 확인되었습니다.',
      NOT_PARTICIPANT: '현재 참여자만 현장 확인할 수 있습니다.',
      FULL: '정원이 마감되었습니다.',
      VERSION_CONFLICT: '내용이 변경되었습니다. 현재 상태를 확인해 주세요.',
      CLOSED: '취소되었거나 시작한 모임입니다.',
      FORBIDDEN: '현재 계정은 이 작업을 수행할 수 없습니다.',
      UNAUTHENTICATED: '로그인 후 다시 확인해 주세요.',
      ACCOUNT_CHANGED: '계정이 변경되었습니다. 화면을 새로 열어 주세요.',
      SCHEDULE_LOCKED: '다른 참여자 또는 현장 확인이 있는 모임의 장소·시간은 변경할 수 없습니다.',
      CAPACITY: '현재 참여 인원보다 정원을 줄일 수 없습니다.',
      INVALID_INPUT: '입력한 내용을 확인해 주세요.',
      EMAIL_NOT_VERIFIED: '이메일 인증 후 다시 시도해 주세요.',
      INVALID_PLACE: '등록된 시설을 선택해 주세요.',
      RATE_LIMITED: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
      COMMAND_CONFLICT: '같은 요청 번호의 내용이 달라졌습니다. 저장 결과를 확인해 주세요.',
      STARTED: '시작 시간은 현재 이후로 설정해 주세요.',
    };
    throw new MeetingRequestError(
      response.status,
      code,
      messages[code] ?? '요청을 확인하지 못했습니다. 현재 상태를 다시 조회해 주세요.',
    );
  }
  return schema.parse(body);
}
