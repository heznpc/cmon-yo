import { test, expect, type Page, type APIRequestContext } from './fixtures';
import { randomUUID } from 'node:crypto';
test.use({ actionTimeout: 12_000 });

test.beforeEach(async ({ request, baseURL }) => {
  expect((await request.post(baseURL + '/_test/reset-limits')).ok()).toBe(true);
});
async function account(request: APIRequestContext, origin: string, label: string) {
  const email = `flow-${randomUUID()}@example.test`,
    password = 'Local-Only-' + randomUUID();
  const result = await request.post(origin + '/api/native/auth/sign-up/email', {
    data: { email, password, name: label, callbackURL: '/account' },
  });
  expect(result.ok()).toBe(true);
  const mail = await request.get(origin + '/_test/mail', { params: { email, purpose: 'verify' } });
  expect((await request.get((await mail.json()).url)).ok()).toBe(true);
  return { email, password };
}
async function login(page: Page, user: { email: string; password: string }) {
  await page.getByLabel('이메일', { exact: true }).fill(user.email);
  await page.getByLabel(/^비밀번호/).fill(user.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
}
test('Web create, edit, join, leave, host cancel, response recovery, private switching and small screen', async ({
  page,
  context,
  browser,
  request,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const origin = baseURL!;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const host = await account(request, origin, '주최 시험 사용자');
  const guest = await account(request, origin, '참여 시험 사용자');
  await page.goto('/meetups/new?placeId=park-46840-00023');
  await page.getByRole('link', { name: '로그인하고 계속하기' }).click();
  await login(page, host);
  await expect(page).toHaveURL(/\/meetups\/new/);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const title = '[시험] 긴 제목의 동네 걷기 약속 ' + randomUUID().slice(0, 8);
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page
    .getByLabel('설명', { exact: true })
    .fill('처음 오시는 분도 같이 걸어요. <script>텍스트</script>');
  await page.getByRole('combobox', { name: '장소', exact: true }).selectOption('park-46840-00023');
  const future = new Date(Date.now() + 172800000);
  const end = new Date(future.getTime() + 3600000);
  await page.getByLabel('시작 날짜').fill(future.toISOString().slice(0, 10));
  await page.getByLabel('시작 시간').fill(future.toISOString().slice(11, 16));
  await page.getByLabel('종료 날짜').fill(end.toISOString().slice(0, 10));
  await page.getByLabel('종료 시간').fill(end.toISOString().slice(11, 16));
  await page.getByLabel('정원 · 주최자 포함').fill('2');
  await page.route('**/api/v1/meetups', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
      });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '모임 생성', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('응답을 확인하지 못했습니다');
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue(title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('create-retained-mobile.png'), fullPage: true });
  await page.unroute('**/api/v1/meetups');
  await page.getByRole('button', { name: '같은 요청 다시 보내기' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const path = new URL(page.url()).pathname;
  await page.getByRole('button', { name: '모임 수정', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill(title + ' 수정');
  await page.getByRole('button', { name: '수정 저장' }).click();
  await expect(page.getByRole('heading', { name: title + ' 수정', exact: true })).toBeVisible();
  const guestContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const guestPage = await guestContext.newPage();
  guestPage.on('pageerror', (e) => errors.push(e.message));
  await guestPage.goto(path);
  await guestPage.getByRole('link', { name: '로그인하고 계속하기' }).click();
  await login(guestPage, guest);
  await expect(guestPage).toHaveURL(origin + path);
  // Server commits but the browser loses the mutation response.
  await guestPage.route('**/api/v1/meetups/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await guestPage.getByRole('button', { name: '참여하기', exact: true }).click();
  await expect(
    guestPage.getByRole('alert').filter({ hasText: '응답을 확인하지 못했습니다' }),
  ).toBeVisible();
  await guestPage.unroute('**/api/v1/meetups/*');
  await guestPage.getByRole('button', { name: '요청 처리 상태 확인' }).click();
  await expect(guestPage.getByText('참여 중입니다.', { exact: true })).toBeVisible();
  await guestPage.getByRole('link', { name: '내 모임', exact: true }).click();
  await expect(guestPage.getByRole('link', { name: title + ' 수정', exact: true })).toBeVisible();
  await guestPage.getByRole('link', { name: title + ' 수정', exact: true }).click();
  await guestPage.getByRole('button', { name: '참여 취소', exact: true }).click();
  await guestPage.getByRole('button', { name: '취소 확정', exact: true }).click();
  await expect(guestPage.getByRole('button', { name: '참여하기', exact: true })).toBeVisible();
  await guestPage.getByRole('link', { name: '내 모임', exact: true }).click();
  await expect(guestPage.getByText(/참여 취소 ·/)).toBeVisible();
  await page.getByRole('button', { name: '현재 상태 다시 조회' }).click();
  await page.getByRole('button', { name: '모임 취소', exact: true }).click();
  await page.getByRole('button', { name: '취소 확정', exact: true }).click();
  await expect(page.getByText('모임 취소 · 1/2명', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '내 모임', exact: true }).click();
  await page.screenshot({ path: info.outputPath('host-cancelled.png'), fullPage: true });
  // A's already-fetched response arrives after another tab signs out and B logs in.
  let release: () => void = () => {};
  let captured: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const capture = new Promise<void>((r) => {
    captured = r;
  });
  await page.route('**/api/v1/me/meetups?*', async (route) => {
    const response = await route.fetch();
    captured();
    await gate;
    try {
      await route.fulfill({ response });
    } catch {
      /* request was cancelled with the old account */
    }
  });
  await page.getByRole('button', { name: '내 모임 새로고침' }).click();
  await capture;
  const other = await context.newPage();
  await other.goto('/account');
  await other.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('link', { name: '로그인하고 계속하기' })).toBeVisible();
  await login(other, guest);
  await expect(other.getByText('참여 시험 사용자님', { exact: true })).toBeVisible();
  release();
  await page.unroute('**/api/v1/me/meetups?*');
  await page.reload();
  await expect(page.getByText(/주최 ·/)).toHaveCount(0);
  await expect(page.getByText(/참여 취소 · 모임 취소/)).toBeVisible();
  await page.goBack();
  await page.goto('/account/meetups');
  await expect(page.getByText(/주최 ·/)).toHaveCount(0);
  expect(await page.title()).toContain("C'mon Yo!");
  expect(errors).toEqual([]);
  expect(await page.locator('vite-error-overlay').count()).toBe(0);
  await other.close();
  await guestContext.close();
});
