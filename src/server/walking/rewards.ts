import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { rewardCatalog, walkingPolicy } from '../../contracts/walking';
import { fail } from './policy';

// Call only inside the walking user lock. A claim and its credit commit together.
export async function award(
  client: pg.PoolClient,
  user: string,
  input: { scope: string; day?: string; milestone?: number; expeditionId?: string; stage?: number; amount: number; title: string },
  at: Date,
) {
  const prior = (await client.query('SELECT id FROM walking_claims WHERE user_id=$1 AND scope=$2', [user, input.scope])).rows[0];
  if (prior) return prior.id as string;
  const id = randomUUID();
  await client.query(
    `INSERT INTO walking_claims(id,user_id,scope,activity_day,daily_milestone,expedition_id,stage,reward,policy_version,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, user, input.scope, input.day ?? null, input.milestone ?? null, input.expeditionId ?? null, input.stage ?? null, input.amount, walkingPolicy.version, at],
  );
  await client.query('INSERT INTO walking_ledger(id,user_id,claim_id,amount,title,created_at) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), user, id, input.amount, input.title, at]);
  return id;
}

export async function redeem(client: pg.PoolClient, user: string, badgeId: string, at: Date) {
  const item = rewardCatalog.find((entry) => entry.id === badgeId);
  if (!item) return fail(400, 'INVALID_BADGE', '교환할 배지를 확인해 주세요.');
  const owned = (await client.query('SELECT id FROM walking_badges WHERE user_id=$1 AND badge_id=$2', [user, badgeId])).rows[0];
  if (owned) return owned.id as string;
  // The account advisory lock serializes balance, debit and ownership changes.
  const balance = Number((await client.query('SELECT COALESCE(sum(amount),0) AS balance FROM walking_ledger WHERE user_id=$1', [user])).rows[0].balance);
  if (balance < item.price) return fail(409, 'INSUFFICIENT_POINTS', '포인트가 부족합니다.');
  const id = randomUUID();
  await client.query('INSERT INTO walking_badges(id,user_id,badge_id,price,created_at) VALUES($1,$2,$3,$4,$5)', [id, user, badgeId, item.price, at]);
  await client.query('INSERT INTO walking_ledger(id,user_id,badge_id,amount,title,created_at) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), user, id, -item.price, item.title + ' 배지 교환', at]);
  return id;
}
