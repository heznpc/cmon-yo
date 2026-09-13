import { z } from 'zod';
export const commandActionSchema = z.enum([
  'create',
  'edit',
  'delete',
  'comment',
  'deleteComment',
  'profile',
  'report',
  'block',
  'join',
  'leave',
  'cancel',
  'checkIn',
  'requestReview',
  'review',
]);
export function commandAction(input: unknown) {
  if (!input || typeof input !== 'object') return undefined;
  const value = input as Record<string, unknown>;
  const body =
    value.body && typeof value.body === 'object'
      ? (value.body as Record<string, unknown>)
      : undefined;
  const parsed = commandActionSchema.safeParse(
    value.action ?? body?.action ?? (value.method === 'POST' ? 'create' : undefined),
  );
  return parsed.success ? parsed.data : undefined;
}
export const clientEventSchema = z
  .object({
    event: z.enum([
      'browser_error',
      'unhandled_rejection',
      'hydration_error',
      'request_failed',
      'command',
    ]),
    pageRequestId: z.uuid().optional(),
    requestId: z.uuid().optional(),
    commandId: z.uuid().optional(),
    action: commandActionSchema.optional(),
    area: z.enum(['community', 'meeting', 'attendance']).optional(),
    outcome: z
      .enum([
        'sent',
        'succeeded',
        'unknown',
        'rejected',
        'retried',
        'recovered',
        'not_found',
        'lookup_failed',
        'storage_failed',
      ])
      .optional(),
    status: z.number().int().min(0).max(599).optional(),
  })
  .strict();
export type ClientEvent = z.infer<typeof clientEventSchema>;
