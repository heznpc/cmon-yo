import type { z } from 'zod';
const prefix = 'cmon-recovery:v1:';
const ownerKey = prefix + 'account';
const keyFor = (userId: string, scope: string) => prefix + JSON.stringify([userId, scope]);

export function clearRecovery() {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix)) localStorage.removeItem(key);
  } catch {
    /* The UI reports unavailable storage when it next tries to write. */
  }
}
export function activateRecoveryAccount(userId: string | null) {
  try {
    if (localStorage.getItem(ownerKey) !== userId) clearRecovery();
    if (userId) localStorage.setItem(ownerKey, userId);
  } catch {
    /* Reading the account must remain possible without storage. */
  }
}
export function readRecovery<T>(userId: string, scope: string, schema: z.ZodType<T>): T | null {
  if (localStorage.getItem(ownerKey) !== userId) return null;
  const key = keyFor(userId, scope),
    raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}
export function writeRecovery(userId: string, scope: string, value: unknown) {
  // A late callback from an old account cannot recreate cleared private data.
  if (localStorage.getItem(ownerKey) !== userId) throw new Error('Account changed');
  localStorage.setItem(keyFor(userId, scope), JSON.stringify(value));
}
export function removeRecovery(userId: string, scope: string) {
  localStorage.removeItem(keyFor(userId, scope));
}
