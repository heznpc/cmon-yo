import { z } from 'zod';
export const postDraftScope = (id?: string) => 'draft:post:' + (id ?? 'new');
export const postDraftSchema = z.object({
  title: z.string().max(120),
  body: z.string().max(5000),
  sport: z.enum(['walking', 'running', 'cycling']),
  regionCode: z.union([z.literal(''), z.string().regex(/^[0-9]{5}$/)]).default(''),
  placeId: z.string().max(100),
  meetupId: z.string().max(100),
  version: z.number().int().positive().nullable(),
});
