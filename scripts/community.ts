import { createPool } from '../src/server/db';
import { databaseCommunity } from '../src/server/services/community';
import { idSchema } from '../src/contracts/meetup';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required.');
const pool = createPool(process.env.DATABASE_URL);
try {
  const [action, id, decision] = process.argv.slice(2);
  if (action === 'reports')
    console.log(
      JSON.stringify(
        (
          await pool.query(
            "SELECT id,target,target_id,reason,created_at FROM community_reports WHERE status='pending' ORDER BY created_at LIMIT 100",
          )
        ).rows,
        null,
        2,
      ),
    );
  else if (
    action === 'resolve' &&
    idSchema.safeParse(id).success &&
    (decision === 'hidden' || decision === 'dismissed')
  ) {
    await databaseCommunity(pool).moderate(id!, decision);
    console.log('신고 처리 상태를 반영했습니다.');
  } else
    throw new Error('Usage: community reports | community resolve <report UUID> hidden|dismissed');
} finally {
  await pool.end();
}
