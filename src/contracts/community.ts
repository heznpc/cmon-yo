import { z } from 'zod';
import { idSchema } from './meetup';
import { sportSchema } from './meetings';
import { placeIdSchema } from './place';
export const postInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(5000),
    sport: sportSchema,
    regionCode: z.literal('46840').default('46840'),
    placeId: placeIdSchema.nullable().default(null),
    meetupId: idSchema.nullable().default(null),
  })
  .strict();
export const postSchema = postInputSchema.extend({
  id: idSchema,
  authorId: idSchema.nullable(),
  authorName: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
});
export const commentSchema = z.object({
  id: idSchema,
  authorId: idSchema.nullable(),
  authorName: z.string(),
  body: z.string(),
  version: z.number().int().positive(),
  createdAt: z.string(),
});
export const communityCursorSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z~[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
export const communityFiltersSchema = z.object({
  sport: sportSchema.optional(),
  cursor: communityCursorSchema.optional(),
  mine: z.enum(['1']).optional(),
  page: z.coerce.number().int().min(0).max(10000).default(0),
});
export const postListSchema = z.object({
  posts: z.array(postSchema),
  nextPage: z.number().int().nullable(),
  nextCursor: communityCursorSchema.nullable(),
});
export const commentListSchema = z.object({
  comments: z.array(commentSchema),
  nextPage: z.number().int().nullable(),
  nextCursor: communityCursorSchema.nullable(),
});
const version = z.number().int().positive();
export const profileSchema = z.object({
  userId: idSchema,
  name: z.string().trim().min(1).max(60),
  regionCode: z.literal('46840').nullable(),
  version: z.number().int().min(0),
});
export const communityCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('profile'),
      name: z.string().trim().min(1).max(60),
      regionCode: z.literal('46840').nullable(),
      expectedVersion: z.number().int().min(0),
    })
    .strict(),
  z.object({ action: z.literal('create'), input: postInputSchema }).strict(),
  z
    .object({
      action: z.literal('edit'),
      id: idSchema,
      expectedVersion: version,
      input: postInputSchema,
    })
    .strict(),
  z.object({ action: z.literal('delete'), id: idSchema, expectedVersion: version }).strict(),
  z
    .object({
      action: z.literal('comment'),
      parent: z.enum(['post', 'meetup']),
      id: idSchema,
      body: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z.object({ action: z.literal('deleteComment'), id: idSchema, expectedVersion: version }).strict(),
  z
    .object({
      action: z.literal('report'),
      target: z.enum(['post', 'comment']),
      id: idSchema,
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
  z.object({ action: z.literal('block'), id: idSchema, blocked: z.boolean() }).strict(),
]);
export const communityResultSchema = z.object({ id: idSchema.nullable() });
export type CommunityCommand = z.infer<typeof communityCommandSchema>;
export type CommunityFilters = z.infer<typeof communityFiltersSchema>;
export type Post = z.infer<typeof postSchema>;
export type Comment = z.infer<typeof commentSchema>;
export const communityKey = (userId: string | null, ...parts: unknown[]) =>
  ['private', userId, 'community', ...parts] as const;
