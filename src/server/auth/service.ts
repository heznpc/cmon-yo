import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type pg from 'pg';
import type { SendAuthMail } from './mail';
import { bearer } from 'better-auth/plugins/bearer';

export function createAuth({
  pool,
  origin,
  secret,
  sendMail,
  providers = {},
}: {
  pool: pg.Pool;
  origin: string;
  secret: string;
  sendMail: SendAuthMail;
  providers?: BetterAuthOptions['socialProviders'];
}) {
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('AUTH_ORIGIN must be an HTTPS origin or a loopback development origin.');
  if (secret.length < 32) throw new Error('AUTH_SECRET must contain at least 32 characters.');
  return betterAuth({
    appName: "C'mon Yo!",
    database: pool,
    baseURL: origin,
    basePath: '/api/auth',
    secret,
    plugins: [bearer({ requireSignature: true })],
    trustedOrigins: [origin, ...(providers.apple ? ['https://appleid.apple.com'] : [])],
    socialProviders: providers,
    logger: { disabled: true },
    advanced: {
      cookiePrefix: 'cmon',
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: ['x-cmon-client-ip'] },
    },
    user: {
      modelName: 'auth_user',
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: ({ user, url }) =>
          sendMail({ to: user.email, url, purpose: 'delete' }),
      },
    },
    session: {
      modelName: 'auth_session',
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 10,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'auth_account',
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, disableImplicitLinking: true, allowUnlinkingAll: false },
    },
    verification: { modelName: 'auth_verification' },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limit',
      window: 60,
      max: 60,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => sendMail({ to: user.email, url, purpose: 'reset' }),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: ({ user, url }) =>
        sendMail({ to: user.email, url, purpose: 'verify' }),
    },
  });
}
export type AuthService = ReturnType<typeof createAuth>;

export function socialProviders(
  env: NodeJS.ProcessEnv,
): NonNullable<BetterAuthOptions['socialProviders']> {
  const providers: NonNullable<BetterAuthOptions['socialProviders']> = {};
  for (const name of ['google', 'kakao', 'naver'] as const) {
    const prefix = name.toUpperCase();
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (Boolean(clientId) !== Boolean(clientSecret))
      throw new Error(`Incomplete ${prefix} credentials.`);
    if (clientId && clientSecret) providers[name] = { clientId, clientSecret };
  }
  if (Boolean(env.APPLE_CLIENT_ID) !== Boolean(env.APPLE_CLIENT_SECRET))
    throw new Error('Incomplete Apple credentials.');
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET)
    providers.apple = { clientId: env.APPLE_CLIENT_ID, clientSecret: env.APPLE_CLIENT_SECRET };
  return providers;
}
