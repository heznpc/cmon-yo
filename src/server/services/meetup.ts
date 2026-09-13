import { readFile } from 'node:fs/promises';
import { meetupDetailSchema, type MeetupDetail } from '../../contracts/meetup';
export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export type MeetupService = (id: string, signal?: AbortSignal) => Promise<MeetupDetail>;
// Server-only fixture adapter. Each request reads the file so HTTP changes are observable.
export function fixtureService(path = 'contracts/fixtures/meetup.json'): MeetupService {
  return async (id, signal) => {
    const data = meetupDetailSchema.parse(
      JSON.parse(await readFile(path, { encoding: 'utf8', signal })),
    );
    if (data.meetup.id !== id) throw new ServiceError(404, 'NOT_FOUND', '모임을 찾을 수 없습니다.');
    return data;
  };
}
