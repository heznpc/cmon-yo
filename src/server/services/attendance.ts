import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import {
  attendancePolicy,
  evaluatePosition,
  type AttendanceCommand,
} from '../../contracts/attendance';
import { ServiceError } from './meetup';
const fail = (status: number, code: string, message: string): never => {
  throw new ServiceError(status, code, message);
};
export async function migrateAttendance(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(15012893)');
    await c.query(await readFile('db/004_attendance.sql', 'utf8'));
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export function databaseAttendance(pool: pg.Pool, now = () => Date.now()) {
  return {
    async detail(user: string, id: string) {
      const r = (
        await pool.query(
          `SELECT m.host_id,m.status,m.ends_at,p.status AS participation,a.status AS attendance,a.method,a.review FROM meetups m LEFT JOIN participations p ON p.meetup_id=m.id AND p.user_id=$1 LEFT JOIN attendance a ON a.meetup_id=m.id AND a.user_id=$1 WHERE m.id=$2`,
          [user, id],
        )
      ).rows[0];
      if (!r) fail(404, 'NOT_FOUND', '모임을 찾을 수 없습니다.');
      const host = r.host_id === user;
      const requests =
        host && r.status === 'open'
          ? (
              await pool.query(
                `SELECT a.user_id AS "userId",u.name,a.reason,a.review FROM attendance a JOIN auth_user u ON u.id=a.user_id JOIN participations p ON p.meetup_id=a.meetup_id AND p.user_id=a.user_id WHERE a.meetup_id=$1 AND a.review IS NOT NULL AND p.status='joined' ORDER BY a.updated_at,a.user_id`,
                [id],
              )
            ).rows
          : [];
      const expired = now() > r.ends_at.getTime() + 7 * 86400000;
      const currentStatus = ['checked_in', 'no_show', 'attendance_unverified'].includes(
        r.attendance,
      )
        ? r.attendance
        : expired
          ? 'attendance_unverified'
          : now() > r.ends_at.getTime()
            ? 'no_show_pending'
            : 'pending';
      const eligible = r.status === 'open' && r.participation === 'joined';
      return {
        state: {
          userId: user,
          status: eligible ? currentStatus : null,
          method: eligible ? (r.method ?? null) : null,
          review: eligible
            ? expired && r.review === 'pending'
              ? 'expired'
              : (r.review ?? null)
            : null,
        },
        host,
        requests: requests.map((row) => ({
          ...row,
          review: expired && row.review === 'pending' ? 'expired' : row.review,
        })),
        policy: attendancePolicy,
      };
    },
    async result(user: string, key: string) {
      return {
        id:
          (
            await pool.query(
              'SELECT meetup_id FROM attendance_commands WHERE user_id=$1 AND command_id=$2',
              [user, key],
            )
          ).rows[0]?.meetup_id ?? null,
      };
    },
    async command(user: string, key: string, id: string, input: AttendanceCommand) {
      const c = await pool.connect(),
        fingerprint = createHash('sha256').update(JSON.stringify({ id, input })).digest('hex');
      try {
        await c.query('BEGIN');
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,4))', [user + key]);
        const old = (
          await c.query('SELECT * FROM attendance_commands WHERE user_id=$1 AND command_id=$2', [
            user,
            key,
          ])
        ).rows[0];
        if (old) {
          if (old.fingerprint !== fingerprint)
            fail(409, 'COMMAND_CONFLICT', '요청 내용이 달라졌습니다.');
          await c.query('COMMIT');
          return { id: old.meetup_id as string };
        }
        const m = (await c.query('SELECT * FROM meetups WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!m) fail(404, 'NOT_FOUND', '모임을 찾을 수 없습니다.');
        if (m.status !== 'open') fail(409, 'CLOSED', '취소된 모임은 확인할 수 없습니다.');
        const target = input.action === 'review' ? input.userId : user;
        const p = (
          await c.query(
            'SELECT status FROM participations WHERE meetup_id=$1 AND user_id=$2 FOR UPDATE',
            [id, target],
          )
        ).rows[0];
        if (p?.status !== 'joined')
          fail(403, 'NOT_PARTICIPANT', '현재 참여자만 현장 확인할 수 있습니다.');
        const time = now();
        if (input.action === 'requestReview' && m.host_id === user)
          fail(403, 'FORBIDDEN', '주최자는 자신의 수동 확인을 요청할 수 없습니다.');
        if (input.action === 'review') {
          if (m.host_id !== user || target === user)
            fail(403, 'FORBIDDEN', '주최자는 다른 참여자의 요청만 확인할 수 있습니다.');
          if (time > m.ends_at.getTime() + 7 * 86400000)
            fail(409, 'REVIEW_TIME', '확인 기한이 지났습니다.');
          const a = (
            await c.query('SELECT * FROM attendance WHERE meetup_id=$1 AND user_id=$2', [
              id,
              target,
            ])
          ).rows[0];
          if (a?.review !== 'pending') fail(409, 'REVIEW_STATE', '대기 중인 요청이 없습니다.');
          await c.query(
            `UPDATE attendance SET review=$3,status=CASE WHEN $3='approved' THEN 'checked_in' ELSE status END,method=CASE WHEN $3='approved' THEN 'host' ELSE method END,confirmed_by=$4,updated_at=now() WHERE meetup_id=$1 AND user_id=$2`,
            [id, target, input.decision, user],
          );
        } else {
          if (
            time < m.starts_at.getTime() - 30 * 60000 ||
            time > m.ends_at.getTime() + (input.action === 'requestReview' ? 86400000 : 30 * 60000)
          )
            fail(409, 'CHECKIN_TIME', '현장 확인 가능한 시간이 아닙니다.');
          const existing = (
            await c.query(
              'SELECT status,review FROM attendance WHERE meetup_id=$1 AND user_id=$2',
              [id, user],
            )
          ).rows[0];
          if (existing?.status === 'checked_in')
            fail(409, 'ALREADY_CONFIRMED', '이미 현장 확인되었습니다.');
          if (input.action === 'checkIn') {
            const place = (
              await c.query("SELECT document FROM places WHERE document->>'id'=$1", [m.place_id])
            ).rows[0]?.document;
            if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude))
              fail(
                409,
                'POSITION_UNAVAILABLE',
                '약속 위치를 확인하지 못했습니다. 수동 확인을 요청해 주세요.',
              );
            const code = evaluatePosition(
              input.position,
              place,
              m.starts_at.getTime(),
              m.ends_at.getTime(),
              time,
            );
            if (code)
              fail(
                409,
                code,
                '위치를 확인하지 못했습니다. 재시도하거나 수동 확인을 요청해 주세요.',
              );
            await c.query(
              `INSERT INTO attendance(meetup_id,user_id,status,method,policy_version) VALUES($1,$2,'checked_in','location',$3) ON CONFLICT(meetup_id,user_id) DO UPDATE SET status='checked_in',method='location',policy_version=$3,review=NULL,reason=NULL,updated_at=now()`,
              [id, user, attendancePolicy.version],
            );
          } else {
            if (existing?.review === 'pending')
              fail(409, 'REVIEW_STATE', '이미 확인 요청이 접수됐습니다.');
            await c.query(
              `INSERT INTO attendance(meetup_id,user_id,review,reason,policy_version) VALUES($1,$2,'pending',$3,$4) ON CONFLICT(meetup_id,user_id) DO UPDATE SET review='pending',reason=$3,policy_version=$4,updated_at=now()`,
              [id, user, input.reason, attendancePolicy.version],
            );
          }
        }
        await c.query('INSERT INTO attendance_commands VALUES($1,$2,$3,$4)', [
          user,
          key,
          fingerprint,
          id,
        ]);
        await c.query('COMMIT');
        return { id };
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
    async reconcile() {
      await pool.query(
        `UPDATE attendance a SET status=CASE WHEN m.ends_at<now()-interval '7 days' THEN 'attendance_unverified' ELSE 'no_show_pending' END FROM meetups m,participations p WHERE a.meetup_id=m.id AND p.meetup_id=m.id AND p.user_id=a.user_id AND p.status='joined' AND m.status='open' AND m.ends_at<now() AND a.status IN ('pending','no_show_pending')`,
      );
    },
  };
}
export type AttendanceService = ReturnType<typeof databaseAttendance>;
