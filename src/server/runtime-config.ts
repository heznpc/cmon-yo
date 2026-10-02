import { proxyTrust } from './proxy';

// Validate before opening Vite, database connections or a listening socket.
export function runtimeConfig(env: NodeJS.ProcessEnv) {
  const production = env.NODE_ENV === 'production';
  const fixtureMode = env.MEETUP_SOURCE === 'fixture';
  if (env.MEETUP_SOURCE && !['fixture', 'database'].includes(env.MEETUP_SOURCE))
    throw new Error('MEETUP_SOURCE must be database or fixture.');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer from 1 to 65535.');
  if (!production && port > 55535)
    throw new Error('Development PORT must leave room for the HMR port (+10000).');
  const trustProxy = proxyTrust(env.TRUST_PROXY);
  const host = env.HOST ?? '127.0.0.1';
  // Fixture servers are local regression harnesses, never public deployments.
  if ((fixtureMode || production) && !['127.0.0.1', '::1', 'localhost'].includes(host))
    throw new Error('Production and fixture servers must listen on loopback behind the HTTPS proxy.');
  if (!fixtureMode && env.DATABASE_URL && env.AUTH_SECRET) {
    if (env.AUTH_SECRET.length < 32)
      throw new Error('AUTH_SECRET must contain at least 32 characters.');
    const origin = env.AUTH_ORIGIN ?? `http://127.0.0.1:${port}`;
    let parsed: URL;
    try { parsed = new URL(origin); }
    catch { throw new Error('AUTH_ORIGIN must be an HTTPS origin or a loopback development origin.'); }
    if (parsed.origin !== origin || (parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))))
      throw new Error('AUTH_ORIGIN must be an HTTPS origin or a loopback development origin.');
  }
  if (production && !fixtureMode) {
    if (!env.DATABASE_URL) throw new Error('Production requires DATABASE_URL.');
    if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32)
      throw new Error('Production requires AUTH_SECRET with at least 32 characters.');
    let origin: URL;
    try {
      origin = new URL(env.AUTH_ORIGIN ?? '');
    } catch {
      throw new Error('Production requires an HTTPS AUTH_ORIGIN.');
    }
    if (origin.protocol !== 'https:' || origin.origin !== env.AUTH_ORIGIN)
      throw new Error('Production requires an HTTPS AUTH_ORIGIN without a path.');
    if (env.AUTH_MAIL_TRANSPORT !== 'smtp' || !env.EMAIL_SMTP_HOST || !env.EMAIL_FROM)
      throw new Error('Production requires SMTP authentication mail settings.');
    if (Boolean(env.EMAIL_SMTP_USER) !== Boolean(env.EMAIL_SMTP_PASSWORD))
      throw new Error('SMTP credentials must include both user and password.');
  }
  return { production, fixtureMode, port, host, trustProxy };
}
