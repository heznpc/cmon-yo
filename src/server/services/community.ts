import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import {
  postSchema,
  commentSchema,
  type CommunityFilters,
  type CommunityCommand,
} from '../../contracts/community';
import { ServiceError } from './meetup';
const fail = (status: number, code: string, message: string): never => {
  throw new ServiceError(status, code, message);
};
const visible = `NOT t.hidden AND NOT EXISTS (SELECT 1 FROM community_blocks b WHERE (b.user_id=$1 AND b.blocked_id=t.author_id) OR (b.blocked_id=$1 AND b.user_id=t.author_id))`;
const stamp = `to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time`;
const cursorOf = (rows: pg.QueryResultRow[]) =>
  rows.length > 20 ? rows[19].cursor_time + '~' + rows[19].id : null;
const author = `LEFT JOIN auth_user u ON u.id=t.author_id`;
const base = (r: pg.QueryResultRow) => ({
  id: r.id,
  authorId: r.author_id,
  authorName: r.name ?? '탈퇴한 사용자',
  body: r.body,
  version: r.version,
  createdAt: r.created_at.toISOString(),
});
const post = (r: pg.QueryResultRow) =>
  postSchema.parse({
    ...base(r),
    title: r.title,
    sport: r.sport,
    regionCode: r.region_code,
    placeId: r.place_id,
    meetupId: r.meetup_id,
  });
export async function migrateCommunity(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(15012892)');
    await c.query(await readFile('db/003_community.sql', 'utf8'));
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export function databaseCommunity(pool: pg.Pool) {
  const parent = async (
    c: pg.Pool | pg.PoolClient,
    user: string | null,
    kind: 'post' | 'meetup',
    id: string,
    lock = false,
  ) => {
    const query =
      kind === 'post'
        ? `SELECT t.id FROM posts t WHERE ${visible} AND t.id=$2${lock ? ' FOR UPDATE' : ''}`
        : `SELECT id FROM meetups WHERE id=$2 AND $1::uuid IS NOT DISTINCT FROM $1::uuid${lock ? ' FOR UPDATE' : ''}`;
    if (!(await c.query(query, [user, id])).rowCount)
      fail(404, 'NOT_FOUND', '내용을 찾을 수 없습니다.');
  };
  return {
    async list(user: string | null, f: CommunityFilters) {
      if (f.mine && !user) fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
      const { rows } = await pool.query(
        `SELECT t.*,u.name,${stamp} FROM posts t ${author} WHERE ${visible} AND ($2::text IS NULL OR t.sport=$2) AND ($7::text IS NULL OR t.region_code=$7) AND (NOT $3::boolean OR t.author_id=$1) AND ($5::timestamptz IS NULL OR (t.created_at,t.id)<($5::timestamptz,$6::uuid)) ORDER BY t.created_at DESC,t.id DESC LIMIT 21 OFFSET $4`,
        [
          user,
          f.sport ?? null,
          !!f.mine,
          f.cursor ? 0 : f.page * 20,
          f.cursor?.split('~')[0] ?? null,
          f.cursor?.split('~')[1] ?? null,
          f.regionCode ?? null,
        ],
      );
      return {
        posts: rows.slice(0, 20).map(post),
        nextCursor: cursorOf(rows),
        nextPage: rows.length > 20 ? f.page + 1 : null,
      };
    },
    async detail(user: string | null, id: string) {
      const r = (
        await pool.query(`SELECT t.*,u.name FROM posts t ${author} WHERE ${visible} AND t.id=$2`, [
          user,
          id,
        ])
      ).rows[0];
      if (!r) return fail(404, 'NOT_FOUND', '게시글을 찾을 수 없습니다.');
      return post(r);
    },
    async comments(
      user: string | null,
      kind: 'post' | 'meetup',
      id: string,
      page = 0,
      cursor?: string,
    ) {
      await parent(pool, user, kind, id);
      const { rows } = await pool.query(
        `SELECT t.*,u.name,${stamp} FROM comments t ${author} WHERE ${visible} AND t.${kind === 'post' ? 'post_id' : 'meetup_id'}=$2 AND ($4::timestamptz IS NULL OR (t.created_at,t.id)>($4::timestamptz,$5::uuid)) ORDER BY t.created_at,t.id LIMIT 21 OFFSET $3`,
        [
          user,
          id,
          cursor ? 0 : page * 20,
          cursor?.split('~')[0] ?? null,
          cursor?.split('~')[1] ?? null,
        ],
      );
      return {
        comments: rows.slice(0, 20).map((r) => commentSchema.parse(base(r))),
        nextCursor: cursorOf(rows),
        nextPage: rows.length > 20 ? page + 1 : null,
      };
    },
    async profile(user: string) {
      const r = (
        await pool.query(
          'SELECT u.name,p.region_code,p.version FROM auth_user u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1',
          [user],
        )
      ).rows[0];
      if (!r) fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
      return {
        userId: user,
        name: r.name,
        regionCode: r.region_code ?? null,
        version: r.version ?? 0,
      };
    },
    async blocks(user: string) {
      return {
        users: (
          await pool.query(
            `SELECT b.blocked_id AS id,u.name FROM community_blocks b JOIN auth_user u ON u.id=b.blocked_id WHERE b.user_id=$1 ORDER BY u.name,b.blocked_id`,
            [user],
          )
        ).rows as { id: string; name: string }[],
      };
    },
    async result(user: string, id: string) {
      return {
        id:
          (
            await pool.query(
              'SELECT result_id FROM community_commands WHERE user_id=$1 AND command_id=$2',
              [user, id],
            )
          ).rows[0]?.result_id ?? null,
      };
    },
    async command(user: string, key: string, input: CommunityCommand) {
      const c = await pool.connect(),
        fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      try {
        await c.query('BEGIN');
        // One user lock covers both replay and the per-user write budget.
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,3))', [user]);
        const prior = (
          await c.query('SELECT * FROM community_commands WHERE user_id=$1 AND command_id=$2', [
            user,
            key,
          ])
        ).rows[0];
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            fail(409, 'COMMAND_CONFLICT', '요청 내용이 달라졌습니다.');
          await c.query('COMMIT');
          return { id: prior.result_id as string };
        }
        if (
          (
            await c.query(
              "SELECT count(*)::int n FROM community_commands WHERE user_id=$1 AND created_at>now()-interval '1 minute'",
              [user],
            )
          ).rows[0].n >= 20
        )
          fail(429, 'RATE_LIMITED', '잠시 후 다시 작성해 주세요.');
        let id = 'id' in input ? input.id : randomUUID();
        if (input.action === 'profile') {
          id = user;
          await c.query('INSERT INTO user_profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING', [
            user,
          ]);
          const current = (
            await c.query('SELECT version FROM user_profiles WHERE user_id=$1 FOR UPDATE', [user])
          ).rows[0];
          if (current.version !== input.expectedVersion)
            fail(409, 'VERSION_CONFLICT', '계정 정보가 변경되었습니다. 다시 확인해 주세요.');
          await c.query('UPDATE auth_user SET name=$2 WHERE id=$1', [user, input.name]);
          await c.query(
            'UPDATE user_profiles SET region_code=$2,version=version+1 WHERE user_id=$1',
            [user, input.regionCode],
          );
        }
        if (input.action === 'create' || input.action === 'edit') {
          const v = input.input;
          if (
            v.placeId &&
            !(await c.query("SELECT 1 FROM places WHERE document->>'id'=$1", [v.placeId])).rowCount
          )
            fail(400, 'INVALID_PLACE', '등록된 시설을 선택해 주세요.');
          if (v.meetupId) await parent(c, user, 'meetup', v.meetupId);
          if (input.action === 'create')
            await c.query(
              'INSERT INTO posts(id,author_id,title,body,sport,region_code,place_id,meetup_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [id, user, v.title, v.body, v.sport, v.regionCode, v.placeId, v.meetupId],
            );
        }
        if (
          input.action === 'edit' ||
          input.action === 'delete' ||
          input.action === 'deleteComment'
        ) {
          const table = input.action === 'deleteComment' ? 'comments' : 'posts';
          const r = (await c.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [id])).rows[0];
          if (!r || r.hidden) fail(404, 'NOT_FOUND', '내용을 찾을 수 없습니다.');
          if (r.author_id !== user) fail(403, 'FORBIDDEN', '작성자만 변경할 수 있습니다.');
          if (r.version !== input.expectedVersion)
            fail(409, 'VERSION_CONFLICT', '내용이 변경되었습니다. 다시 확인해 주세요.');
          if (input.action === 'edit') {
            const v = input.input;
            await c.query(
              'UPDATE posts SET title=$2,body=$3,sport=$4,place_id=$5,meetup_id=$6,region_code=$7,version=version+1 WHERE id=$1',
              [id, v.title, v.body, v.sport, v.placeId, v.meetupId, v.regionCode],
            );
          } else
            await c.query(`UPDATE ${table} SET hidden=true,version=version+1 WHERE id=$1`, [id]);
        } else if (input.action === 'comment') {
          await parent(c, user, input.parent, id, true);
          id = randomUUID();
          await c.query(
            `INSERT INTO comments(id,author_id,${input.parent === 'post' ? 'post_id' : 'meetup_id'},body) VALUES($1,$2,$3,$4)`,
            [id, user, input.id, input.body],
          );
        } else if (input.action === 'report') {
          const table = input.target === 'post' ? 'posts' : 'comments';
          if (
            !(await c.query(`SELECT id FROM ${table} t WHERE ${visible} AND t.id=$2`, [user, id]))
              .rowCount
          )
            fail(404, 'NOT_FOUND', '내용을 찾을 수 없습니다.');
          id = (
            await c.query(
              'INSERT INTO community_reports(id,user_id,target,target_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,target,target_id) DO UPDATE SET reason=EXCLUDED.reason RETURNING id',
              [randomUUID(), user, input.target, input.id, input.reason],
            )
          ).rows[0].id;
        } else if (input.action === 'block') {
          if (id === user) fail(400, 'INVALID_INPUT', '자신을 차단할 수 없습니다.');
          if (!(await c.query('SELECT id FROM auth_user WHERE id=$1', [id])).rowCount)
            fail(404, 'NOT_FOUND', '사용자를 찾을 수 없습니다.');
          if (input.blocked)
            await c.query('INSERT INTO community_blocks VALUES($1,$2) ON CONFLICT DO NOTHING', [
              user,
              id,
            ]);
          else
            await c.query('DELETE FROM community_blocks WHERE user_id=$1 AND blocked_id=$2', [
              user,
              id,
            ]);
        }
        await c.query(
          'INSERT INTO community_commands(user_id,command_id,fingerprint,result_id) VALUES($1,$2,$3,$4)',
          [user, key, fingerprint, id],
        );
        await c.query('COMMIT');
        return { id };
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
    async moderate(reportId: string, decision: 'hidden' | 'dismissed') {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = (
          await c.query('SELECT * FROM community_reports WHERE id=$1 FOR UPDATE', [reportId])
        ).rows[0];
        if (!r) fail(404, 'NOT_FOUND', '신고를 찾을 수 없습니다.');
        if (decision === 'hidden')
          await c.query(
            `UPDATE ${r.target === 'post' ? 'posts' : 'comments'} SET hidden=true,version=version+1 WHERE id=$1`,
            [r.target_id],
          );
        await c.query('UPDATE community_reports SET status=$2 WHERE id=$1', [reportId, decision]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
export type CommunityService = ReturnType<typeof databaseCommunity>;
