import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('email lifecycle, original-target return, cross-tab sign-out and small-screen failure recovery', async ({
  page,
  context,
  request,
  baseURL,
}, testInfo) => {
  test.setTimeout(60_000);
  const origin = baseURL!;
  const email = `ui-${randomUUID()}@example.test`;
  const password = 'Local-UI-Only-' + randomUUID();
  const latestMail = async (purpose: string) => {
    const response = await request.get('/_test/mail', { params: { email, purpose } });
    expect(response.ok()).toBe(true);
    return (await response.json()).url as string;
  };
  const signIn = async () => {
    const response = page.waitForResponse(
      (value) => new URL(value.url()).pathname === '/api/auth/sign-in/email',
    );
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    const result = await response;
    if (result.status() === 429) {
      await expect(page.getByRole('alert')).toContainText('요청이 많습니다');
      const seconds = Number(result.headers()['retry-after']);
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(10);
      await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
      await page.getByRole('button', { name: '로그인', exact: true }).click();
    }
  };
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.goto(origin + '/account?returnTo=/meetups/11111111-1111-4111-8111-111111111111');
  await expect(page).toHaveTitle("C'mon Yo! · 내 계정");
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await page.getByRole('textbox', { name: '닉네임', exact: true }).fill('계정 흐름 확인');
  await page.getByRole('textbox', { name: '이메일', exact: true }).fill(email);
  await page.getByRole('textbox', { name: '비밀번호 12~128자', exact: true }).fill(password);
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('인증 메일');
  await signIn();
  await expect(page.getByRole('alert')).toContainText('이메일 인증');
  await expect(page.getByRole('alert')).toBeFocused();
  const verified = await fetch(await latestMail('verify'), { redirect: 'manual' });
  if (verified.status !== 302) throw new Error('Verification did not redirect');
  await signIn();
  await expect(page).toHaveURL(origin + '/meetups/11111111-1111-4111-8111-111111111111');
  await page.goto(origin + '/account');
  await expect(page.getByRole('region', { name: '로그인한 계정' })).toContainText('계정 흐름 확인');
  await page.reload();
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto(origin + '/account');
  await other.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(other.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
  await expect(page.getByText('계정 흐름 확인님')).toHaveCount(0);
  await other.close();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('textbox', { name: '이메일', exact: true }).fill(email);
  await page.getByRole('textbox', { name: '비밀번호 12~128자', exact: true }).fill(password);
  await context.setOffline(true);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('alert')).not.toBeEmpty();
  await expect(page.getByRole('alert')).toBeFocused();

  await expect(page.getByRole('textbox', { name: '이메일', exact: true })).toHaveValue(email);
  await context.setOffline(false);
  await signIn();
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
    throw new Error('Horizontal overflow at 320px/200%');
  await page.screenshot({ path: testInfo.outputPath('account-small.png'), fullPage: true });
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await page.getByRole('button', { name: '비밀번호 재설정 메일 받기', exact: true }).click();
  await page.getByRole('textbox', { name: '이메일', exact: true }).fill(email);
  await page.getByRole('button', { name: '비밀번호 재설정 메일 받기', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('등록된 계정이면');
  await page.goto(await latestMail('reset'));
  await expect(page.getByRole('button', { name: '새 비밀번호 저장', exact: true })).toBeVisible();
  await page
    .getByRole('textbox', { name: '비밀번호 12~128자', exact: true })
    .fill(password + '-changed');
  await page.getByRole('button', { name: '새 비밀번호 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('비밀번호를 변경');
  if (new URL(page.url()).searchParams.has('token'))
    throw new Error('Reset token persisted in final URL');
  await page.getByRole('textbox', { name: '이메일', exact: true }).fill(email);
  await page
    .getByRole('textbox', { name: '비밀번호 12~128자', exact: true })
    .fill(password + '-changed');
  await signIn();
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '계정 탈퇴 메일 받기', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('탈퇴 확인 메일');
  await page.goto(await latestMail('delete'));
  await expect(page.getByRole('heading', { name: '로그인', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('account-login.png'), fullPage: true });
  if (runtimeErrors.length) throw new Error('Browser runtime errors: ' + runtimeErrors.join(';'));
});
