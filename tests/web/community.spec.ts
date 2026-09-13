import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.beforeEach(async ({ request, baseURL }) => {
  expect((await request.post(baseURL + '/_test/reset-limits')).ok()).toBe(true);
});
async function account(request: APIRequestContext, origin: string, name: string) {
  const email = `community-${randomUUID()}@example.test`,
    password = 'Local-Only-' + randomUUID();
  expect(
    (
      await request.post(origin + '/api/auth/sign-up/email', {
        headers: { Origin: origin },
        data: { email, password, name, callbackURL: '/account' },
      })
    ).ok(),
  ).toBe(true);
  const mail = await request.get(origin + '/_test/mail', { params: { email, purpose: 'verify' } });
  expect((await request.get((await mail.json()).url)).ok()).toBe(true);
  return { email, password };
}
async function login(page: Page, user: { email: string; password: string }) {
  await page.getByLabel('이메일', { exact: true }).fill(user.email);
  await page.getByLabel(/^비밀번호/).fill(user.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
}
test('community SSR, hydration, input recovery, comments, ownership, block and deletion', async ({
  page,
  request,
  baseURL,
  browser,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const a = await account(request, baseURL!, '글쓴이 시험'),
    b = await account(request, baseURL!, '댓글쓴이 시험');
  await page.goto('/community/new');
  await page.getByRole('link', { name: '로그인하고 작성하기' }).click();
  await login(page, a);
  await expect(page).toHaveURL(/\/community\/new/);
  const noJS = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  const initialForm = await noJS.newPage();
  await initialForm.goto('/community/new');
  await expect(initialForm.getByLabel('제목', { exact: true })).toBeDisabled();
  await noJS.close();
  const title = '[시험] 동네 질문 ' + randomUUID().slice(0, 6);
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page
    .getByLabel('본문', { exact: true })
    .fill('<script>alert("unsafe")</script> 함께 걸어요.');
  await page.route('**/api/v1/community/commands', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
    }),
  );
  await page.getByRole('button', { name: '게시글 저장', exact: true }).click();
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue(title);
  await expect(page.getByRole('button', { name: '저장 결과 확인' })).toBeVisible();
  await page.unroute('**/api/v1/community/commands');
  await page.getByRole('button', { name: '같은 요청 다시 보내기' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const path = new URL(page.url()).pathname;
  const html = await request.get(baseURL! + path);
  expect(html.status()).toBe(200);
  expect(await html.text()).toContain(title);
  expect(await html.text()).not.toContain('<script>alert("unsafe")</script>');
  let reads = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/posts')) reads++;
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '글 수정', exact: true })).toBeEnabled();
  expect(reads).toBe(0);
  await page.getByRole('button', { name: '글 수정', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill(title + ' 수정');
  await page.getByRole('button', { name: '게시글 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: title + ' 수정', exact: true })).toBeVisible();
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const other = await context.newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto(path);
  await other.getByRole('link', { name: '로그인하고 작성하기' }).click();
  await login(other, b);
  await expect(other).toHaveURL(baseURL! + path);
  await expect(other.getByRole('button', { name: '글 수정', exact: true })).toHaveCount(0);
  await other.getByLabel('댓글 내용').fill('시험 댓글');
  let unrelatedPostReads = 0;
  other.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/v1/posts/' + path.split('/').at(-1))
      unrelatedPostReads++;
  });
  await other.route('**/api/v1/community/commands', async (route) => {
    await route.fetch();
    await route.abort('failed');
  });
  await other.getByRole('button', { name: '댓글 등록', exact: true }).click();
  await expect(other.getByRole('button', { name: '저장 결과 확인' })).toBeVisible();
  await other.unroute('**/api/v1/community/commands');
  await other.getByRole('button', { name: '저장 결과 확인' }).click();
  await expect(other.getByText('댓글쓴이 시험: 시험 댓글', { exact: true })).toBeVisible();
  expect(unrelatedPostReads).toBe(0);
  await other.getByText('신고·차단', { exact: true }).first().click();
  await other.getByLabel('신고 사유').first().fill('시험 신고');
  await other.getByRole('button', { name: '신고 접수', exact: true }).first().click();
  await expect(other.getByRole('status')).toContainText('운영 처리 전');
  await other.getByRole('button', { name: '작성자 차단', exact: true }).first().click();
  await other.getByRole('button', { name: '작성자 차단 확정', exact: true }).click();
  await expect(other).toHaveURL(/\/community$/);
  await expect(other.getByRole('link', { name: title + ' 수정', exact: true })).toHaveCount(0);
  await other.route('**/api/v1/me/blocks', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }),
    }),
  );
  await other.goto('/account/posts');
  await expect(other.getByRole('alert')).toContainText('차단 목록을 불러오지 못했습니다.');
  await other.unroute('**/api/v1/me/blocks');
  await other.getByRole('button', { name: '차단 목록 다시 조회' }).click();
  await other.getByRole('button', { name: '차단 해제' }).click();
  await other.goto(path);
  await expect(other.getByRole('heading', { name: title + ' 수정', exact: true })).toBeVisible();
  await context.close();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(page.getByRole('heading', { name: title + ' 수정', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('community-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '글 삭제', exact: true }).click();
  await page.getByRole('button', { name: '글 삭제 확정', exact: true }).click();
  await expect(page).toHaveURL(/\/community$/);
  expect((await request.get(baseURL! + path)).status()).toBe(404);
  expect(errors).toEqual([]);
});

test('Web activity profile and attendance: denied location, review, host confirmation and GPS', async ({
  page,
  context,
  browser,
  request,
  baseURL,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const host = await account(request, baseURL!, '현장 주최 시험'),
    guest = await account(request, baseURL!, '현장 참여 시험');
  await page.goto('/account');
  await login(page, host);
  await expect(page.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  await page.goto('/activity');
  await page.getByLabel('닉네임', { exact: true }).fill('현장 주최 변경');
  await page.getByLabel('선택 동네').selectOption('46840');
  await page.getByRole('button', { name: '프로필 저장' }).click();
  await expect(page.getByRole('status')).toContainText('저장했습니다');
  await page.reload();
  await expect(page.getByLabel('닉네임', { exact: true })).toHaveValue('현장 주최 변경');
  const hostId = (await (await page.request.get('/api/v1/me')).json()).user.id;
  const created = await page.request.post('/api/v1/meetups', {
    headers: { Origin: baseURL!, 'X-Cmon-User': hostId, 'Idempotency-Key': randomUUID() },
    data: {
      title: '[시험] 현장 확인 약속',
      description: '현장 확인 시험',
      sport: 'walking',
      placeId: 'park-46840-00023',
      startsAt: new Date(Date.now() + 600000).toISOString(),
      endsAt: new Date(Date.now() + 3600000).toISOString(),
      capacity: 3,
    },
  });
  expect(created.status()).toBe(200);
  const id = (await created.json()).id;
  const otherContext = await browser.newContext({ baseURL });
  const other = await otherContext.newPage();
  other.on('pageerror', (e) => errors.push(e.message));
  await other.goto('/meetups/' + id);
  await other.getByRole('link', { name: '로그인하고 계속하기' }).click();
  await login(other, guest);
  await other.getByRole('button', { name: '참여하기', exact: true }).click();
  await expect(other.getByText('참여 중입니다.', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: '현장 확인', exact: true }).click();
  await expect(other.getByText('현장 확인 대기', { exact: true })).toBeVisible();
  await other.evaluate(() => {
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
      configurable: true,
      value: (_success: unknown, failure: (e: { code: number }) => void) => failure({ code: 1 }),
    });
  });
  await other.getByRole('button', { name: '현재 위치로 확인' }).click();
  await expect(other.getByRole('status').filter({ hasText: '위치 권한이 거부' })).toBeVisible();
  await other.getByLabel('수동 확인 사유').fill('권한 거부 시험');
  await other.getByRole('button', { name: '주최자에게 확인 요청' }).click();
  await expect(other.getByText('수동 요청: 주최자 확인 대기')).toBeVisible();
  await expect(other.getByText('현장 확인됨', { exact: true })).toHaveCount(0);
  await page.goto('/meetups/' + id);
  await page.getByRole('button', { name: '현장 확인', exact: true }).click();
  await expect(page.getByText(/현장 참여 시험: 권한 거부 시험/)).toBeVisible();
  await page.getByRole('button', { name: '현장 참여 확인', exact: true }).click();
  await page.getByRole('button', { name: '현장 참여 확인 확정', exact: true }).click();
  await expect(page.getByText(/현장 참여 시험: 권한 거부 시험 · 승인/)).toBeVisible();
  await other.reload();
  await other.getByRole('button', { name: '현장 확인', exact: true }).click();
  await expect(other.getByText('현장 확인됨', { exact: true })).toBeVisible();
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 34.80642405, longitude: 126.4842218, accuracy: 20 });
  await page.getByRole('button', { name: '현재 위치로 확인' }).click();
  await expect(page.getByText('현장 확인됨', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('attendance-confirmed.png'), fullPage: true });
  await otherContext.close();
  expect(errors).toEqual([]);
});
