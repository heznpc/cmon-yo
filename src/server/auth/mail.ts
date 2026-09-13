import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import nodemailer from 'nodemailer';

export type AuthMail = { to: string; purpose: 'verify' | 'reset' | 'delete'; url: string };
export type SendAuthMail = (message: AuthMail) => Promise<void>;

export function authMailer(env: NodeJS.ProcessEnv): SendAuthMail {
  if (env.AUTH_MAIL_TRANSPORT === 'local' && env.NODE_ENV !== 'production') {
    const directory = resolve('.cache/auth-mail');
    return async (message) => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(resolve(directory, `${randomUUID()}.json`), JSON.stringify(message), {
        mode: 0o600,
        flag: 'wx',
      });
    };
  }
  if (env.AUTH_MAIL_TRANSPORT !== 'smtp' || !env.EMAIL_SMTP_HOST || !env.EMAIL_FROM)
    throw new Error('Configure AUTH_MAIL_TRANSPORT and the required mail settings.');
  const port = Number(env.EMAIL_SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP port.');
  const transport = nodemailer.createTransport({
    host: env.EMAIL_SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: env.EMAIL_SMTP_USER
      ? { user: env.EMAIL_SMTP_USER, pass: env.EMAIL_SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 5000,
    socketTimeout: 10_000,
  });
  return async ({ to, purpose, url }) => {
    const label = { verify: '이메일 인증', reset: '비밀번호 재설정', delete: '계정 탈퇴 확인' }[
      purpose
    ];
    await transport.sendMail({
      from: env.EMAIL_FROM,
      to,
      subject: `C'mon Yo! · ${label}`,
      text: `${label}을 진행하려면 다음 주소를 열어 주세요.\n${url}\n\n요청하지 않았다면 이 메일을 무시해 주세요.`,
    });
  };
}
