import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import {
  meetingSchema,
  type MeetingFilters,
  type MeetingInput,
  meetingCommandSchema,
} from '../../contracts/meetings';
import type { z } from 'zod';
import { ServiceError } from './meetup';

export async function migrateMeetings(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(15012891)');
    await client.query(await readFile('db/002_meetups.sql', 'utf8'));
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
const selection = `SELECT m.*, (SELECT count(*)::int FROM participations p WHERE p.meetup_id=m.id AND p.status='joined') AS participant_count FROM meetups m`;
function dto(row: pg.QueryResultRow) {
  return meetingSchema.parse({
    id: row.id,
    title: row.title,
    description: row.description,
    sport: row.sport,
    place: { id: row.place_id, name: row.place_name },
    regionCode: row.region_code,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    capacity: row.capacity,
    participantCount: row.participant_count,
    status: row.status,
    version: row.version,
  });
}
const reject = (status: number, code: string, message: string): never => {
  throw new ServiceError(status, code, message);
};
export function databaseMeetings(pool?: pg.Pool) {
  const db = () => pool ?? reject(503, 'UNAVAILABLE', '모임 저장소에 연결하지 못했습니다.');
  const detail = async (id: string) => {
    const row = (await db().query(`${selection} WHERE m.id=$1`, [id])).rows[0];
    if (!row) return reject(404, 'NOT_FOUND', '모임을 찾을 수 없습니다.');
    return { meetup: dto(row), viewerParticipation: null };
  };
  return {
    detail,
    async list(filters: MeetingFilters) {
      const { rows } = await db().query(
        `${selection} WHERE m.region_code=$1
        AND ($2::text IS NULL OR m.sport=$2) AND ($3::text IS NULL OR m.place_id=$3)
        AND ($4::date IS NULL OR (m.starts_at AT TIME ZONE 'Asia/Seoul')::date=$4::date)
        ORDER BY m.starts_at,m.id LIMIT 21 OFFSET $5`,
        [
          filters.regionCode,
          filters.sport ?? null,
          filters.placeId ?? null,
          filters.date ?? null,
          filters.page * 20,
        ],
      );
      return {
        meetups: rows.slice(0, 20).map(dto),
        nextPage: rows.length > 20 ? filters.page + 1 : null,
      };
    },
    async membership(userId: string, id: string) {
      const { rows } = await db().query(
        `SELECT m.version, m.host_id, p.status FROM meetups m
        LEFT JOIN participations p ON p.meetup_id=m.id AND p.user_id=$1 WHERE m.id=$2`,
        [userId, id],
      );
      if (!rows[0]) return reject(404, 'NOT_FOUND', '모임을 찾을 수 없습니다.');
      return {
        userId,
        role:
          rows[0].host_id === userId ? 'host' : rows[0].status === 'joined' ? 'participant' : null,
        version: rows[0].version,
      };
    },
    async mine(userId: string, page = 0) {
      const { rows } = await db().query(
        `SELECT m.*, own.status AS participation_status,
        (SELECT count(*)::int FROM participations p WHERE p.meetup_id=m.id AND p.status='joined') AS participant_count
        FROM meetups m LEFT JOIN participations own ON own.meetup_id=m.id AND own.user_id=$1
        WHERE m.host_id=$1 OR own.user_id IS NOT NULL
        ORDER BY m.starts_at,m.id LIMIT 21 OFFSET $2`,
        [userId, page * 20],
      );
      return {
        userId,
        meetups: rows.slice(0, 20).map((row) => ({
          ...dto(row),
          role: row.host_id === userId ? 'host' : 'participant',
          participationStatus: row.participation_status ?? 'cancelled',
        })),
        nextPage: rows.length > 20 ? page + 1 : null,
      };
    },
    async command(
      userId: string,
      commandId: string,
      input: MeetingInput | z.infer<typeof meetingCommandSchema>,
      id?: string,
    ) {
      const client = await db().connect();
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ id: id ?? null, input }))
        .digest('hex');
      try {
        await client.query('BEGIN');
        // Serializes duplicate command IDs, including concurrent create retries.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `${userId}:${commandId}`,
        ]);
        const prior = (
          await client.query('SELECT * FROM meetup_commands WHERE user_id=$1 AND command_id=$2', [
            userId,
            commandId,
          ])
        ).rows[0];
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            reject(409, 'COMMAND_CONFLICT', '같은 요청 번호의 내용이 달라졌습니다.');
          await client.query('COMMIT');
          return { id: prior.meetup_id as string };
        }
        const values = 'action' in input ? input.input : input;
        let placeName: string | undefined;
        if (values) {
          if (new Date(values.startsAt).getTime() <= Date.now())
            reject(409, 'STARTED', '시작 시간은 현재 이후로 설정해 주세요.');
          const place = (
            await client.query(
              "SELECT document->>'name' AS name FROM places WHERE document->>'id'=$1",
              [values.placeId],
            )
          ).rows[0];
          if (!place) reject(400, 'INVALID_PLACE', '등록된 시설을 선택해 주세요.');
          placeName = place.name;
        }
        let meetupId = id;
        if (!('action' in input)) {
          meetupId = randomUUID();
          await client.query(
            `INSERT INTO meetups (id,host_id,title,description,sport,place_id,place_name,region_code,starts_at,ends_at,capacity)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'46840',$8,$9,$10)`,
            [
              meetupId,
              userId,
              input.title,
              input.description,
              input.sport,
              input.placeId,
              placeName,
              input.startsAt,
              input.endsAt,
              input.capacity,
            ],
          );
          await client.query("INSERT INTO participations VALUES ($1,$2,'joined')", [
            meetupId,
            userId,
          ]);
        } else {
          const row = (await client.query('SELECT * FROM meetups WHERE id=$1 FOR UPDATE', [id]))
            .rows[0];
          if (!row) reject(404, 'NOT_FOUND', '모임을 찾을 수 없습니다.');
          const host = row.host_id === userId;
          if ((input.action === 'edit' || input.action === 'cancel') && !host)
            reject(403, 'FORBIDDEN', '주최자만 변경할 수 있습니다.');
          if ((input.action === 'join' || input.action === 'leave') && host)
            reject(409, 'HOST_ACTION', '주최자는 모임 취소를 이용해 주세요.');
          if (row.version !== input.expectedVersion)
            reject(409, 'VERSION_CONFLICT', '모임이 변경되었습니다. 현재 상태를 확인해 주세요.');
          if (row.status !== 'open' || row.starts_at.getTime() <= Date.now())
            reject(409, 'CLOSED', '취소되었거나 시작한 모임은 변경할 수 없습니다.');
          const count = (
            await client.query(
              "SELECT count(*)::int AS count FROM participations WHERE meetup_id=$1 AND status='joined'",
              [id],
            )
          ).rows[0].count;
          if (input.action === 'join') {
            if (count >= row.capacity) reject(409, 'FULL', '정원이 마감되었습니다.');
            await client.query(
              "INSERT INTO participations VALUES ($1,$2,'joined') ON CONFLICT (meetup_id,user_id) DO UPDATE SET status='joined'",
              [id, userId],
            );
          } else if (input.action === 'leave') {
            await client.query(
              "UPDATE participations SET status='cancelled' WHERE meetup_id=$1 AND user_id=$2",
              [id, userId],
            );
          } else if (input.action === 'cancel') {
            await client.query("UPDATE meetups SET status='cancelled' WHERE id=$1", [id]);
          } else if (values) {
            if (values.capacity < count)
              reject(409, 'CAPACITY', '현재 참여 인원보다 정원을 줄일 수 없습니다.');
            await client.query(
              `UPDATE meetups SET title=$2,description=$3,sport=$4,place_id=$5,place_name=$6,starts_at=$7,ends_at=$8,capacity=$9 WHERE id=$1`,
              [
                id,
                values.title,
                values.description,
                values.sport,
                values.placeId,
                placeName,
                values.startsAt,
                values.endsAt,
                values.capacity,
              ],
            );
          }
          await client.query('UPDATE meetups SET version=version+1 WHERE id=$1', [id]);
        }
        await client.query('INSERT INTO meetup_commands VALUES ($1,$2,$3,$4)', [
          userId,
          commandId,
          fingerprint,
          meetupId,
        ]);
        await client.query('COMMIT');
        return { id: meetupId! };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async commandResult(userId: string, commandId: string) {
      const row = (
        await db().query(
          'SELECT meetup_id FROM meetup_commands WHERE user_id=$1 AND command_id=$2',
          [userId, commandId],
        )
      ).rows[0];
      return { id: (row?.meetup_id as string) ?? null };
    },
  };
}
export type MeetingService = ReturnType<typeof databaseMeetings>;
