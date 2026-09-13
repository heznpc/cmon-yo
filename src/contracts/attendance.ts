import { z } from 'zod';
import { idSchema } from './meetup';
export const attendancePolicy = {
  version: 'local-v1',
  earlyMinutes: 30,
  lateMinutes: 30,
  maxAgeSeconds: 120,
  maxAccuracyMeters: 100,
  radiusMeters: 200,
} as const;
export const positionSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000),
    capturedAt: z.number().finite(),
  })
  .strict();
export const attendanceCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('checkIn'), position: positionSchema }).strict(),
  z
    .object({ action: z.literal('requestReview'), reason: z.string().trim().min(1).max(500) })
    .strict(),
  z
    .object({
      action: z.literal('review'),
      userId: idSchema,
      decision: z.enum(['approved', 'rejected']),
    })
    .strict(),
]);
export const attendanceStateSchema = z.object({
  userId: idSchema,
  status: z
    .enum(['pending', 'checked_in', 'no_show_pending', 'attendance_unverified', 'no_show'])
    .nullable(),
  method: z.enum(['location', 'host']).nullable(),
  review: z.enum(['pending', 'approved', 'rejected', 'expired']).nullable(),
});
export const attendanceSchema = z.object({
  state: attendanceStateSchema,
  host: z.boolean(),
  requests: z.array(
    z.object({
      userId: idSchema,
      name: z.string(),
      reason: z.string(),
      review: z.enum(['pending', 'approved', 'rejected', 'expired']),
    }),
  ),
  policy: z.object({
    version: z.string(),
    earlyMinutes: z.number(),
    lateMinutes: z.number(),
    maxAgeSeconds: z.number(),
    maxAccuracyMeters: z.number(),
    radiusMeters: z.number(),
  }),
});
export type AttendanceCommand = z.infer<typeof attendanceCommandSchema>;
export type CheckPosition = z.infer<typeof positionSchema>;
export function evaluatePosition(
  position: CheckPosition,
  place: { latitude: number; longitude: number },
  start: number,
  end: number,
  now: number,
): string | null {
  if (
    now < start - attendancePolicy.earlyMinutes * 60000 ||
    now > end + attendancePolicy.lateMinutes * 60000
  )
    return 'CHECKIN_TIME';
  if (
    position.capturedAt > now + 10000 ||
    now - position.capturedAt > attendancePolicy.maxAgeSeconds * 1000
  )
    return 'STALE_POSITION';
  if (position.accuracy > attendancePolicy.maxAccuracyMeters) return 'INACCURATE_POSITION';
  const rad = (n: number) => (n * Math.PI) / 180;
  const a =
    Math.sin(rad(position.latitude - place.latitude) / 2) ** 2 +
    Math.cos(rad(place.latitude)) *
      Math.cos(rad(position.latitude)) *
      Math.sin(rad(position.longitude - place.longitude) / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
  return distance > attendancePolicy.radiusMeters ? 'OUTSIDE_PLACE' : null;
}
