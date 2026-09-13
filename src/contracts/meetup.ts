import { z } from 'zod';
export const idSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  );
const text = z.string().min(1);
const utc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((v) => {
    const d = new Date(v);
    return Number.isFinite(d.valueOf()) && d.toISOString() === v;
  });
export const meetupDetailSchema = z.object({
  meetup: z
    .object({
      id: idSchema,
      title: text,
      description: z
        .string()
        .nullable()
        .optional()
        .transform((v) => v ?? null),
      sport: text.transform((v) => (['walking', 'running', 'cycling'].includes(v) ? v : 'unknown')),
      startsAt: utc,
      endsAt: utc,
      capacity: z.number().int().positive().max(2147483647),
      place: z.object({ id: idSchema, name: text }),
    })
    .refine((m) => m.endsAt > m.startsAt),
  viewerParticipation: z.null(),
});
export type MeetupDetail = z.infer<typeof meetupDetailSchema>;
export const meetupKey = (id: string) => ['meetup', id] as const;
export const staleTime = 60_000;
