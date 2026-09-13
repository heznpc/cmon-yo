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
  await expect(other.getByRole('status').filter({ hasText: '운영 처리 전' })).toBeVisible();
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
  await expect(other.getByRole('button', { name: '차단 해제' })).toHaveCount(0);
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

test('post drafts survive facility navigation and reload, isolate targets, discard and clear on save', async ({
  page,
  request,
  baseURL,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const user = await account(request, baseURL!, '초안 시험');
  await page.goto('/account?returnTo=%2Fcommunity%2Fnew');
  await login(page, user);
  await expect(page).toHaveURL(/\/community\/new/);
  const title = '주말 산책 코스를 함께 정해요 ' + randomUUID().slice(0, 6);
  const body =
    '공원 시설을 잠깐 확인하고 돌아와서 글을 마무리하려고 합니다.\n아직 작성 중입니다.  ';
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page.getByLabel('본문', { exact: true }).fill(body);
  await page.getByRole('link', { name: '둘러보기', exact: true }).click();
  await expect(page).toHaveURL(/\/places/);
  await page.goBack();
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue(title);
  await expect(page.getByLabel('본문', { exact: true })).toHaveValue(body);
  await page.reload();
  await expect(page.getByLabel('본문', { exact: true })).toHaveValue(body);
  await expect(page).toHaveTitle("C'mon Yo! · 커뮤니티");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/cmon-draft-' + info.project.name + '.png', fullPage: true });
  await page.getByRole('button', { name: '초안 폐기', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('');
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page.getByLabel('본문', { exact: true }).fill(body);
  await page.getByRole('button', { name: '게시글 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const post = new URL(page.url()).pathname;
  await page.getByRole('button', { name: '글 수정', exact: true }).click();
  await page.getByLabel('제목', { exact: true }).fill(title + ' 수정 초안');
  await page.goto('/community/new');
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('');
  await page.goto(post);
  await page.getByRole('button', { name: '글 수정', exact: true }).click();
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue(title + ' 수정 초안');
  expect(errors).toEqual([]);
});

test('unconfirmed commands persist before sending and reconcile after reload without duplicate posts', async ({
  page,
  request,
  baseURL,
}) => {
  const user = await account(request, baseURL!, '요청 복구 시험');
  await page.goto('/account?returnTo=%2Fcommunity%2Fnew');
  await login(page, user);
  const title = '응답 유실 복구 ' + randomUUID();
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page.getByLabel('본문', { exact: true }).fill('서버 저장 후 응답만 유실');
  let sent = 0;
  await page.route('**/api/v1/community/commands', async (route) => {
    sent++;
    const key = route.request().headers()['idempotency-key'];
    expect(
      await page.evaluate(
        (key) => Object.values(localStorage).some((value) => value.includes(key)),
        key,
      ),
    ).toBe(true);
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '게시글 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장 결과 확인' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(sent).toBe(1);
  const posts = await (await page.request.get('/api/v1/posts?mine=1')).json();
  expect(posts.posts.filter((post: { title: string }) => post.title === title)).toHaveLength(1);
  await page.goto('/community/new');
  await expect(page.getByLabel('제목', { exact: true })).toHaveValue('');
});

test('unsent unknown command keeps the same number through reload and explicit retry', async ({
  page,
  request,
  baseURL,
}) => {
  const user = await account(request, baseURL!, '재전송 시험');
  await page.goto('/account?returnTo=%2Fcommunity%2Fnew');
  await login(page, user);
  await page.getByLabel('제목', { exact: true }).fill('같은 번호로 다시 보내기');
  await page.getByLabel('본문', { exact: true }).fill('미전송 시험 본문');
  let original = '';
  await page.route('**/api/v1/community/commands', (route) => {
    original = route.request().headers()['idempotency-key'];
    return route.abort('failed');
  });
  await page.getByRole('button', { name: '게시글 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '같은 요청 다시 보내기' })).toBeEnabled();
  await page.reload();
  await expect(page.getByText(/아직 저장 결과가 없습니다/)).toBeVisible();
  await expect(page.getByRole('button', { name: '게시글 저장', exact: true })).toBeDisabled();
  await page.unroute('**/api/v1/community/commands');
  await page.route('**/api/v1/community/commands', (route) => {
    expect(route.request().headers()['idempotency-key']).toBe(original);
    return route.continue();
  });
  await page.getByRole('button', { name: '같은 요청 다시 보내기' }).click();
  await expect(
    page.getByRole('heading', { name: '같은 번호로 다시 보내기', exact: true }),
  ).toBeVisible();
});

test('account transition clears drafts and pending request records across tabs', async ({
  page,
  request,
  baseURL,
  context,
}) => {
  const user = await account(request, baseURL!, '계정 정리 시험');
  await page.goto('/account?returnTo=%2Fcommunity%2Fnew');
  await login(page, user);
  await page.getByLabel('제목', { exact: true }).fill('계정 전환 시 삭제할 초안');
  await page.getByLabel('본문', { exact: true }).fill('계정 전용 본문');
  await page.route('**/api/v1/community/commands', (route) => route.abort('failed'));
  await page.getByRole('button', { name: '게시글 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장 결과 확인' })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/account');
  await other.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('link', { name: '로그인하고 작성하기' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('cmon-recovery:')),
    ),
  ).toEqual([]);
  await login(other, user);
  await expect(other.getByRole('button', { name: '로그아웃', exact: true })).toBeVisible();
  await other.goto('/community/new');
  await expect(other.getByLabel('제목', { exact: true })).toHaveValue('');
  await expect(other.getByRole('button', { name: '저장 결과 확인' })).toHaveCount(0);
});

test('unavailable browser storage explains draft loss and prevents an untracked submission', async ({
  page,
  request,
  baseURL,
}) => {
  const user = await account(request, baseURL!, '저장 공간 시험');
  await page.goto('/account?returnTo=%2Fcommunity%2Fnew');
  await login(page, user);
  await expect(page.getByLabel('제목', { exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('cmon-recovery:')) throw new DOMException('Quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  let writes = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/v1/community/commands') writes++;
  });
  await page.getByLabel('제목', { exact: true }).fill('저장 공간 부족');
  await page.getByLabel('본문', { exact: true }).fill('화면에서 유지할 본문');
  await expect(page.getByText(/임시 저장에 실패했습니다/)).toBeVisible();
  await page.getByRole('button', { name: '게시글 저장', exact: true }).click();
  await expect(page.getByText(/요청 번호를 보관하지 못해 전송하지 않았습니다/)).toBeVisible();
  expect(writes).toBe(0);
  await expect(page.getByLabel('본문', { exact: true })).toHaveValue('화면에서 유지할 본문');
});

test('native web-session configuration binds the verified account and rejects browser requests', async ({
  request,
  baseURL,
  browser,
}) => {
  const user = await account(request, baseURL!, '웹뷰 세션 시험');
  const response = await request.post(baseURL + '/api/native/auth/sign-in/email', { data: user });
  expect(response.ok()).toBe(true);
  const { token } = await response.json();
  const native = { Authorization: 'Bearer ' + token };
  const configResponse = await request.post(baseURL + '/api/native/web-session', {
    headers: native,
    data: {},
  });
  expect(configResponse.status()).toBe(200);
  const config = await configResponse.json();
  expect(Object.keys(config).sort()).toEqual(['cookieName', 'secure', 'userId']);
  expect(configResponse.headers()['cache-control']).toBe('private, no-store');
  expect(
    (
      await request.post(baseURL + '/api/native/web-session', {
        headers: { ...native, Origin: baseURL! },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await request.post(baseURL + '/api/native/web-session', { data: {} })).status()).toBe(
    401,
  );
  const context = await browser.newContext({ baseURL });
  try {
    await context.addCookies([
      {
        name: config.cookieName,
        value: token,
        url: baseURL!,
        httpOnly: true,
        secure: config.secure,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    await page.goto('/community/new');
    await expect(page.getByLabel('제목', { exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.cookie)).not.toContain('session_token');
    expect((await (await page.request.get('/api/v1/me')).json()).user.id).toBe(config.userId);
    await request.post(baseURL + '/api/native/auth/sign-out', { headers: native, data: {} });
    expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  } finally {
    await context.close();
  }
});
