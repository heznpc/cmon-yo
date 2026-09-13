import { z } from 'zod';
import { idSchema } from './meetup';
import { placeIdSchema } from './place';

const utc = z.iso.datetime({ precision: 3 }).refine((v) => new Date(v).toISOString() === v);
export const sportSchema = z.enum(['walking', 'running', 'cycling']);
export const meetingInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
    sport: sportSchema,
    placeId: placeIdSchema,
    startsAt: utc,
    endsAt: utc,
    capacity: z.number().int().min(2).max(100),
  })
  .strict()
  .refine((v) => v.endsAt > v.startsAt, { message: '종료는 시작 이후여야 합니다.' });
export type MeetingInput = z.infer<typeof meetingInputSchema>;
export const meetingSchema = z.object({
  id: idSchema,
  title: z.string(),
  description: z.string(),
  sport: sportSchema,
  place: z.object({ id: placeIdSchema, name: z.string() }),
  regionCode: z.literal('46840'),
  startsAt: utc,
  endsAt: utc,
  capacity: z.number().int().min(2).max(100),
  participantCount: z.number().int().min(0).max(100),
  status: z.enum(['open', 'cancelled']),
  version: z.number().int().positive(),
});
export type Meeting = z.infer<typeof meetingSchema>;
export const meetingDetailSchema = z.object({
  meetup: meetingSchema,
  viewerParticipation: z.null(),
});
export const meetingFiltersSchema = z.object({
  regionCode: z.literal('46840').default('46840'),
  sport: sportSchema.optional(),
  date: z.iso.date().optional(),
  placeId: placeIdSchema.optional(),
  page: z.coerce.number().int().min(0).max(10000).default(0),
});
export type MeetingFilters = z.infer<typeof meetingFiltersSchema>;
export const meetingListSchema = z.object({
  meetups: z.array(meetingSchema),
  nextPage: z.number().int().nullable(),
});
export const membershipSchema = z.object({
  userId: idSchema,
  role: z.enum(['host', 'participant']).nullable(),
  version: z.number().int().positive(),
});
export const myMeetingsSchema = z.object({
  userId: idSchema,
  meetups: z.array(
    meetingSchema.extend({
      role: z.enum(['host', 'participant']),
      participationStatus: z.enum(['joined', 'cancelled']),
    }),
  ),
  nextPage: z.number().int().nullable(),
});
export const meetingCommandSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    action: z.enum(['join', 'leave', 'cancel', 'edit']),
    input: meetingInputSchema.optional(),
  })
  .strict()
  .refine((v) => (v.action === 'edit' ? !!v.input : !v.input));
export const meetingKey = (id: string) => ['meetings', 'detail', id] as const;
export const meetingListKey = (filters: MeetingFilters) => ['meetings', 'list', filters] as const;
export const membershipKey = (userId: string | null, id: string) =>
  ['private', userId, 'membership', id] as const;
export const myMeetingsKey = (userId: string | null, page = 0) =>
  ['private', userId, 'meetings', page] as const;
