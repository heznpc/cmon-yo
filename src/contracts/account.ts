import { z } from 'zod';

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
    if (url.origin !== base || !/^\/(?:places|meetups|account)(?:\/|$)/.test(url.pathname))
      return '/account';
    return url.pathname + url.search;
  } catch {
    return '/account';
  }
}
