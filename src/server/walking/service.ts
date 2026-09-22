import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { walkingCommandSchema, walkingDashboardSchema, walkingPolicy, rewardCatalog, type WalkingCommand, type WalkingDashboard } from '../../contracts/walking';
import { transaction } from '../transaction';
import { award, redeem } from './rewards';
import { canonicalCommand, dailyPoints, fail, fingerprint, iso, recentDay, seoulDay, shiftDay } from './policy';

type Member = { id: string; user_id: string | null; display_name: string; withdrawn_at: Date | null; steps: number };
type Expedition = { id: string; title: string; invite_code: string; place_id: string | null; place_name: string | null; starts_on: string; ends_on: string };
const expeditionColumns = 'e.id,e.title,e.invite_code,e.place_id,e.place_name,e.starts_on::text,e.ends_on::text';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function account(client: pg.PoolClient, user: string) {
  if (!uuid.test(user)) return fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  // Hold the account against deletion/unverification until this request commits.
  // Order: own account row, own advisory lock, expedition UUIDs, own ledger.
  const row = (await client.query('SELECT name,"emailVerified" AS verified FROM auth_user WHERE id=$1 FOR SHARE', [user])).rows[0];
  if (!row) return fail(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  if (!row.verified) return fail(403, 'EMAIL_NOT_VERIFIED', '이메일 인증이 필요합니다.');
  return row.name as string;
}

async function members(client: pg.PoolClient, expeditionId: string): Promise<Member[]> {
  return (await client.query(
    `SELECT m.id,m.user_id,m.display_name,m.withdrawn_at,
       (m.snapshot_steps+COALESCE(sum(c.steps),0))::int AS steps
     FROM expedition_members m LEFT JOIN expedition_contributions c ON c.member_id=m.id
     WHERE m.expedition_id=$1 GROUP BY m.id ORDER BY m.joined_at,m.id`, [expeditionId],
  )).rows as Member[];
}

async function lockExpedition(client: pg.PoolClient, id: string) {
  const expedition = (await client.query(`SELECT ${expeditionColumns} FROM expeditions e WHERE e.id=$1 FOR UPDATE`, [id])).rows[0] as Expedition | undefined;
  if (!expedition) return fail(404, 'EXPEDITION_NOT_FOUND', '원정을 찾을 수 없습니다.');
  return expedition;
}

async function noOverlap(client: pg.PoolClient, user: string, starts: string, ends: string) {
  if ((await client.query(
    `SELECT 1 FROM expedition_members m JOIN expeditions e ON e.id=m.expedition_id
     WHERE m.user_id=$1 AND m.withdrawn_at IS NULL AND e.starts_on<$3::date AND e.ends_on>$2::date LIMIT 1`,
    [user, starts, ends],
  )).rowCount) fail(409, 'EXPEDITION_OVERLAP', '같은 기간에는 원정 하나에만 참여할 수 있습니다.');
}

async function addMember(client: pg.PoolClient, user: string, name: string, expeditionId: string, at: Date) {
  await client.query('INSERT INTO expedition_members(id,expedition_id,user_id,display_name,joined_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(), expeditionId, user, name, at]);
}

async function bindHealth(client: pg.PoolClient, user: string, deviceId: string, at: Date) {
  // A separate device lock closes cross-account first-binding races.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,61))', [deviceId]);
  const device = (await client.query('SELECT user_id FROM walking_devices WHERE device_id=$1', [deviceId])).rows[0];
  if (device && device.user_id !== user) return fail(409, 'DEVICE_BOUND', '이 기기는 다른 계정에 연결되어 있습니다.');
  await client.query('INSERT INTO walking_devices(device_id,user_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [deviceId, user, at]);
  const current = (await client.query('SELECT id,device_id FROM health_sources WHERE user_id=$1', [user])).rows[0];
  if (current?.device_id === deviceId) return current.id as string;
  const id = randomUUID();
  await client.query(
    `INSERT INTO health_sources(user_id,id,device_id,created_at) VALUES($1,$2,$3,$4)
     ON CONFLICT(user_id) DO UPDATE SET id=EXCLUDED.id,device_id=EXCLUDED.device_id,revision=0,fingerprint=NULL,created_at=EXCLUDED.created_at`,
    [user, id, deviceId, at],
  );
  return id;
}

async function syncHealth(client: pg.PoolClient, user: string, input: Extract<WalkingCommand, { action: 'syncHealth' }>, digest: string, today: string, at: Date) {
  const source = (await client.query('SELECT * FROM health_sources WHERE user_id=$1', [user])).rows[0];
  if (!source || source.id !== input.sourceId) return fail(409, 'SOURCE_CHANGED', '건강 데이터 연결을 다시 확인해 주세요.');
  const revision = Number(source.revision);
  if (input.revision < revision) return fail(409, 'STALE_REVISION', '더 최신 걸음 기록이 이미 반영되었습니다.');
  if (input.revision === revision) {
    if (source.fingerprint !== digest) return fail(409, 'REVISION_CONFLICT', '같은 기록 번호의 내용이 달라졌습니다.');
    return source.id as string;
  }
  if (input.days.some((day) => !recentDay(day.day, today)))
    return fail(400, 'DAY_OUT_OF_RANGE', '서울 기준 오늘부터 7일 전까지의 기록만 보낼 수 있습니다.');
  for (const day of input.days) {
    // Replacing a device never sums its counter with the previous source.
    // Corrections change the displayed actual count while game credit is stable.
    await client.query(
      `INSERT INTO activity_daily(user_id,day,steps,credited_steps,source_id,revision,updated_at)
       VALUES($1,$2,$3,LEAST($3,10000),$4,$5,$6)
       ON CONFLICT(user_id,day) DO UPDATE SET steps=EXCLUDED.steps,
       credited_steps=GREATEST(activity_daily.credited_steps,EXCLUDED.credited_steps),
       source_id=EXCLUDED.source_id,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at`,
      [user, day.day, day.steps, input.sourceId, input.revision, at],
    );
  }
  const expeditions = (await client.query(
    `SELECT ${expeditionColumns},m.id AS member_id FROM expeditions e JOIN expedition_members m ON m.expedition_id=e.id
     WHERE m.user_id=$1 AND m.withdrawn_at IS NULL AND e.starts_on<=$2::date AND e.ends_on+7>$2::date
     ORDER BY e.id FOR UPDATE OF e`, [user, today],
  )).rows as (Expedition & { member_id: string })[];
  for (const expedition of expeditions) {
    for (const day of input.days) {
      if (day.day < expedition.starts_on || day.day >= expedition.ends_on) continue;
      await client.query(
        `INSERT INTO expedition_contributions(member_id,day,steps)
         SELECT $1,day,credited_steps FROM activity_daily WHERE user_id=$2 AND day=$3
         ON CONFLICT(member_id,day) DO UPDATE SET steps=GREATEST(expedition_contributions.steps,EXCLUDED.steps)`,
        [expedition.member_id, user, day.day],
      );
    }
  }
  await client.query('UPDATE health_sources SET revision=$2,fingerprint=$3 WHERE user_id=$1', [user, input.revision, digest]);
  return source.id as string;
}

async function claimDaily(client: pg.PoolClient, user: string, day: string, today: string, at: Date) {
  if (!recentDay(day, today)) return fail(409, 'DAILY_CLAIM_EXPIRED', '일일 포인트 수령 기한이 지났습니다.');
  const steps = (await client.query('SELECT credited_steps FROM activity_daily WHERE user_id=$1 AND day=$2', [user, day])).rows[0]?.credited_steps ?? 0;
  const points = dailyPoints(steps);
  if (!points) return fail(409, 'NOTHING_TO_CLAIM', '1,000걸음부터 포인트를 받을 수 있습니다.');
  let id = '';
  for (let milestone = 1; milestone <= points; milestone++) {
    id = await award(client, user, { scope: `daily:${day}:${milestone}`, day, milestone, amount: 1, title: `${day} 걷기 ${(milestone * 1000).toLocaleString('ko-KR')}걸음` }, at);
  }
  return id;
}

async function createExpedition(client: pg.PoolClient, user: string, name: string, input: Extract<WalkingCommand, { action: 'createExpedition' }>, today: string, at: Date) {
  const starts = shiftDay(today, 1), ends = shiftDay(starts, walkingPolicy.durationDays);
  await noOverlap(client, user, starts, ends);
  let placeName: string | null = null;
  if (input.placeId) {
    const place = (await client.query("SELECT document->>'name' AS name FROM places WHERE document->>'id'=$1", [input.placeId])).rows[0];
    if (!place) return fail(400, 'INVALID_PLACE', '등록된 시설을 선택해 주세요.');
    placeName = place.name as string;
  }
  const id = randomUUID(), code = randomBytes(6).toString('hex').toUpperCase();
  await client.query(
    'INSERT INTO expeditions(id,title,invite_code,place_id,place_name,starts_on,ends_on,policy_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, input.title, code, input.placeId, placeName, starts, ends, walkingPolicy.version, at],
  );
  await addMember(client, user, name, id, at);
  return id;
}

async function joinExpedition(client: pg.PoolClient, user: string, name: string, code: string, today: string, at: Date) {
  const expedition = (await client.query(`SELECT ${expeditionColumns} FROM expeditions e WHERE e.invite_code=$1 FOR UPDATE`, [code])).rows[0] as Expedition | undefined;
  if (!expedition) return fail(404, 'EXPEDITION_NOT_FOUND', '초대 코드에 맞는 원정이 없습니다.');
  const joined = (await client.query('SELECT withdrawn_at FROM expedition_members WHERE expedition_id=$1 AND user_id=$2', [expedition.id, user])).rows[0];
  if (joined?.withdrawn_at) return fail(409, 'EXPEDITION_WITHDRAWN', '탈퇴한 원정에는 다시 참여할 수 없습니다.');
  if (joined) return expedition.id;
  if (today >= expedition.starts_on) return fail(409, 'RECRUITMENT_CLOSED', '원정이 시작되어 모집이 마감되었습니다.');
  await noOverlap(client, user, expedition.starts_on, expedition.ends_on);
  const size = Number((await client.query('SELECT count(*) AS size FROM expedition_members WHERE expedition_id=$1', [expedition.id])).rows[0].size);
  if (size >= walkingPolicy.maxMembers) return fail(409, 'EXPEDITION_FULL', '원정 인원이 모두 찼습니다.');
  await addMember(client, user, name, expedition.id, at);
  return expedition.id;
}

async function leaveExpedition(client: pg.PoolClient, user: string, id: string, today: string, at: Date) {
  const expedition = await lockExpedition(client, id);
  const member = (await client.query('SELECT id,withdrawn_at FROM expedition_members WHERE expedition_id=$1 AND user_id=$2', [id, user])).rows[0];
  if (!member) return fail(403, 'NOT_EXPEDITION_MEMBER', '참여한 원정만 변경할 수 있습니다.');
  if (member.withdrawn_at) return id;
  if (today < expedition.starts_on) {
    await client.query('DELETE FROM expedition_members WHERE id=$1', [member.id]);
  } else {
    await client.query(
      `UPDATE expedition_members m SET withdrawn_at=$2,
       snapshot_steps=m.snapshot_steps+COALESCE((SELECT sum(c.steps) FROM expedition_contributions c WHERE c.member_id=m.id),0)
       WHERE m.id=$1`, [member.id, at],
    );
    await client.query('DELETE FROM expedition_contributions WHERE member_id=$1', [member.id]);
  }
  return id;
}

async function claimStage(client: pg.PoolClient, user: string, id: string, stageIndex: number, today: string, at: Date) {
  const expedition = await lockExpedition(client, id);
  const group = await members(client, id), own = group.find((member) => member.user_id === user);
  if (!own || own.withdrawn_at) return fail(403, 'NOT_EXPEDITION_MEMBER', '현재 원정 참여자만 보상을 받을 수 있습니다.');
  if (today < expedition.starts_on || today >= shiftDay(expedition.ends_on, 7))
    return fail(409, 'STAGE_CLAIM_TIME', '원정 보상 수령 기간이 아닙니다.');
  const stage = walkingPolicy.stages[stageIndex];
  const steps = group.reduce((total, member) => total + member.steps, 0);
  const contributors = group.filter((member) => member.steps >= walkingPolicy.minimumContribution).length;
  if (!stage || own.steps < walkingPolicy.minimumContribution || contributors < walkingPolicy.minimumContributors || steps < stage.threshold)
    return fail(409, 'STAGE_LOCKED', '공동 목표와 개인 기여 조건을 먼저 채워 주세요.');
  return award(client, user, { scope: `expedition:${id}:${stageIndex}`, expeditionId: id, stage: stageIndex, amount: stage.reward, title: `${expedition.title} · ${stage.title}` }, at);
}

export function databaseWalking(pool: pg.Pool, now = () => Date.now()) {
  return {
    async dashboard(user: string): Promise<WalkingDashboard> {
      user = user.toLowerCase();
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await account(client, user);
        const today = seoulDay(now());
        const source = (await client.query('SELECT id,device_id,revision FROM health_sources WHERE user_id=$1', [user])).rows[0];
        const daily = (await client.query(
          `SELECT d.day::text,d.steps,d.credited_steps,d.updated_at,
           (SELECT count(*)::int FROM walking_claims c WHERE c.user_id=d.user_id AND c.activity_day=d.day) AS claimed_points
           FROM activity_daily d WHERE d.user_id=$1 AND d.day BETWEEN $2::date-7 AND $2::date ORDER BY d.day DESC`, [user, today],
        )).rows;
        const rows = (await client.query(
          `SELECT ${expeditionColumns} FROM expeditions e JOIN expedition_members m ON m.expedition_id=e.id
           WHERE m.user_id=$1 ORDER BY e.starts_on DESC,e.id DESC LIMIT 20`, [user],
        )).rows as Expedition[];
        const claims = (await client.query('SELECT expedition_id,stage FROM walking_claims WHERE user_id=$1 AND expedition_id=ANY($2::uuid[])', [user, rows.map((row) => row.id)])).rows;
        const expeditions = [];
        for (const expedition of rows) {
          const group = await members(client, expedition.id), own = group.find((member) => member.user_id === user)!;
          const steps = group.reduce((total, member) => total + member.steps, 0);
          const eligibleContributors = group.filter((member) => member.steps >= walkingPolicy.minimumContribution).length;
          const state = own.withdrawn_at ? 'withdrawn' : today < expedition.starts_on ? 'recruiting' : today < expedition.ends_on ? 'active' : 'ended';
          expeditions.push({
            id: expedition.id, title: expedition.title,
            inviteCode: state === 'recruiting' ? expedition.invite_code : null,
            placeId: expedition.place_id, placeName: expedition.place_name,
            startsOn: expedition.starts_on, endsOn: expedition.ends_on, state, steps, eligibleContributors, ownSteps: own.steps,
            members: group.map((member) => ({ name: member.display_name, steps: member.steps, isMe: member.user_id === user, withdrawn: !!member.withdrawn_at })),
            stages: walkingPolicy.stages.map((stage, index) => {
              const unlocked = steps >= stage.threshold && eligibleContributors >= walkingPolicy.minimumContributors;
              const claimed = claims.some((claim) => claim.expedition_id === expedition.id && claim.stage === index);
              return { index, ...stage, unlocked, claimed, claimable: unlocked && !claimed && !own.withdrawn_at && own.steps >= walkingPolicy.minimumContribution && today >= expedition.starts_on && today < shiftDay(expedition.ends_on, 7) };
            }),
          });
        }
        const balance = Number((await client.query('SELECT COALESCE(sum(amount),0) AS balance FROM walking_ledger WHERE user_id=$1', [user])).rows[0].balance);
        const ledger = (await client.query('SELECT id,amount,title,created_at FROM walking_ledger WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50', [user])).rows;
        const badges = (await client.query('SELECT badge_id FROM walking_badges WHERE user_id=$1', [user])).rows;
        return walkingDashboardSchema.parse({
          userId: user, today, timezone: walkingPolicy.timezone, sourceId: source?.id ?? null, sourceDeviceId: source?.device_id ?? null, sourceRevision: Number(source?.revision ?? 0),
          dailyCap: walkingPolicy.dailyCap, stepsPerPoint: walkingPolicy.stepsPerPoint, balance,
          days: daily.map((day) => ({ day: day.day, steps: day.steps, creditedSteps: day.credited_steps, availablePoints: dailyPoints(day.credited_steps) - day.claimed_points, claimedPoints: day.claimed_points, updatedAt: iso(day.updated_at) })),
          expeditions, ledger: ledger.map((entry) => ({ id: entry.id, amount: entry.amount, title: entry.title, createdAt: iso(entry.created_at) })),
          catalog: rewardCatalog.map((item) => ({ ...item, owned: badges.some((badge) => badge.badge_id === item.id) })),
        });
      });
    },
    async result(user: string, key: string): Promise<{ id: string | null }> {
      user = user.toLowerCase();
      key = key.toLowerCase();
      if (!uuid.test(key)) return fail(400, 'INVALID_COMMAND_KEY', '요청 번호를 확인해 주세요.');
      return transaction(pool, async (client) => {
        await account(client, user);
        return { id: (await client.query('SELECT result_id FROM walking_commands WHERE user_id=$1 AND command_id=$2', [user, key])).rows[0]?.result_id ?? null };
      });
    },
    async command(user: string, key: string, value: WalkingCommand): Promise<{ id: string }> {
      user = user.toLowerCase();
      key = key.toLowerCase();
      if (!uuid.test(key)) return fail(400, 'INVALID_COMMAND_KEY', '요청 번호를 확인해 주세요.');
      const parsed = walkingCommandSchema.safeParse(value);
      if (!parsed.success) return fail(400, 'INVALID_INPUT', '보낸 내용을 확인해 주세요.');
      const input = canonicalCommand(parsed.data), digest = fingerprint(input);
      return transaction(pool, async (client) => {
        const name = await account(client, user);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,6))', [user]);
        const prior = (await client.query('SELECT fingerprint,result_id FROM walking_commands WHERE user_id=$1 AND command_id=$2', [user, key])).rows[0];
        if (prior) {
          if (prior.fingerprint !== digest) return fail(409, 'COMMAND_CONFLICT', '요청 내용이 달라졌습니다.');
          return { id: prior.result_id as string };
        }
        const at = new Date(now()), today = seoulDay(at.getTime());
        const budget = (await client.query(
          `SELECT count(*)::int AS daily,
           count(*) FILTER(WHERE created_at>$2::timestamptz-interval '1 minute')::int AS minute,
           count(*) FILTER(WHERE action='bindHealth')::int AS bindings,
           count(*) FILTER(WHERE action='createExpedition')::int AS creations
           FROM walking_commands WHERE user_id=$1 AND created_at>$2::timestamptz-interval '1 day'`, [user, at],
        )).rows[0];
        if (budget.minute >= 60 || budget.daily >= 1440 || (input.action === 'bindHealth' && budget.bindings >= 10) || (input.action === 'createExpedition' && budget.creations >= 5))
          return fail(429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.');
        let id: string;
        switch (input.action) {
          case 'bindHealth': id = await bindHealth(client, user, input.deviceId, at); break;
          case 'syncHealth': id = await syncHealth(client, user, input, digest, today, at); break;
          case 'claimDaily': id = await claimDaily(client, user, input.day, today, at); break;
          case 'createExpedition': id = await createExpedition(client, user, name, input, today, at); break;
          case 'joinExpedition': id = await joinExpedition(client, user, name, input.code, today, at); break;
          case 'leaveExpedition': id = await leaveExpedition(client, user, input.expeditionId, today, at); break;
          case 'claimStage': id = await claimStage(client, user, input.expeditionId, input.stage, today, at); break;
          case 'redeemBadge': id = await redeem(client, user, input.badgeId, at); break;
        }
        await client.query('INSERT INTO walking_commands(user_id,command_id,action,fingerprint,result_id,created_at) VALUES($1,$2,$3,$4,$5,$6)', [user, key, input.action, digest, id, at]);
        return { id };
      });
    },
  };
}
export type WalkingService = ReturnType<typeof databaseWalking>;
