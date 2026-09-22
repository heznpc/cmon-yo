import { z } from 'zod';

export const walkingPolicy = {
  version: 'walking-v1',
  timezone: 'Asia/Seoul',
  dailyCap: 10000,
  stepsPerPoint: 1000,
  maxMembers: 5,
  durationDays: 7,
  minimumContribution: 1000,
  minimumContributors: 2,
  stages: [
    { threshold: 10000, title: '출발 지점', reward: 5 },
    { threshold: 30000, title: '함께 걷는 길', reward: 10 },
    { threshold: 60000, title: '원정 완주', reward: 20 },
  ],
} as const;
export const rewardCatalog = [
  { id: 'sprout', title: '새싹 산책가', price: 5 },
  { id: 'trail', title: '동네 탐험가', price: 20 },
  { id: 'summit', title: '원정 동료', price: 50 },
] as const;
export const walkingDateSchema = z.iso.date();
export const walkingCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('bindHealth'), deviceId: z.uuid() }).strict(),
  z.object({ action: z.literal('syncHealth'), sourceId: z.uuid(), revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), days: z.array(z.object({ day: walkingDateSchema, steps: z.number().int().min(0).max(100000) }).strict()).min(1).max(8) }).strict(),
  z.object({ action: z.literal('claimDaily'), day: walkingDateSchema }).strict(),
  z.object({ action: z.literal('createExpedition'), title: z.string().trim().min(1).max(80), placeId: z.string().regex(/^park-[0-9]{5}-[0-9]{5}$/).nullable() }).strict(),
  z.object({ action: z.literal('joinExpedition'), code: z.string().trim().regex(/^[A-Z0-9]{12}$/) }).strict(),
  z.object({ action: z.literal('leaveExpedition'), expeditionId: z.uuid() }).strict(),
  z.object({ action: z.literal('claimStage'), expeditionId: z.uuid(), stage: z.number().int().min(0).max(2) }).strict(),
  z.object({ action: z.literal('redeemBadge'), badgeId: z.enum(['sprout', 'trail', 'summit']) }).strict(),
]);
export const walkingDaySchema = z.object({
  day: walkingDateSchema,
  steps: z.number().int().nonnegative(),
  creditedSteps: z.number().int().min(0).max(10000),
  availablePoints: z.number().int().nonnegative(),
  claimedPoints: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export const expeditionSchema = z.object({
  id: z.uuid(), title: z.string(), inviteCode: z.string().nullable(),
  placeId: z.string().nullable(), placeName: z.string().nullable(),
  startsOn: walkingDateSchema, endsOn: walkingDateSchema,
  state: z.enum(['recruiting', 'active', 'ended', 'withdrawn']),
  steps: z.number().int().nonnegative(), eligibleContributors: z.number().int().nonnegative(),
  ownSteps: z.number().int().nonnegative(),
  members: z.array(z.object({ name: z.string(), steps: z.number().int().nonnegative(), isMe: z.boolean(), withdrawn: z.boolean() })),
  stages: z.array(z.object({ index: z.number().int(), title: z.string(), threshold: z.number().int(), reward: z.number().int(), unlocked: z.boolean(), claimed: z.boolean(), claimable: z.boolean() })),
});
export const walkingDashboardSchema = z.object({
  userId: z.uuid(), today: walkingDateSchema, timezone: z.literal('Asia/Seoul'),
  sourceId: z.uuid().nullable(), sourceDeviceId: z.uuid().nullable(),
  sourceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dailyCap: z.number().int(), stepsPerPoint: z.number().int(),
  balance: z.number().int(), days: z.array(walkingDaySchema), expeditions: z.array(expeditionSchema),
  ledger: z.array(z.object({ id: z.uuid(), amount: z.number().int(), title: z.string(), createdAt: z.string() })),
  catalog: z.array(z.object({ id: z.string(), title: z.string(), price: z.number().int(), owned: z.boolean() })),
});
export type WalkingCommand = z.infer<typeof walkingCommandSchema>;
export type WalkingDashboard = z.infer<typeof walkingDashboardSchema>;
export const walkingKey = (userId: string | null) => ['private', userId, 'walking'] as const;
