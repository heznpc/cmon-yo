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
  const response = await fetch(path, { credentials: 'same-origin', ...options });
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
