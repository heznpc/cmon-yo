import { z } from 'zod';

// Shared by browser and Native writes. Keep legacy account reads permissive.
export const accountNameSchema = z.string().trim().min(1).max(60)
  .refine((value) => !value.includes('\0'));

export const accountUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.email(),
  emailVerified: z.boolean(),
});
export const accountSchema = z.object({ user: accountUserSchema.nullable() });
export type Account = z.infer<typeof accountSchema>;
export const accountKey = (userId: string | null) => ['private', userId, 'account'] as const;

export function accountReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value))
    return '/account';
  const base = 'https://return.invalid';
  try {
    const url = new URL(value, base);
    if (url.origin !== base || !/^\/(?:places|meetups|account|community|activity|quests)(?:\/|$)/.test(url.pathname))
      return '/account';
    return url.pathname + url.search;
  } catch {
    return '/account';
  }
}
