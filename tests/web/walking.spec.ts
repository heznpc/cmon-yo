import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type APIRequestContext } from './fixtures';
import { walkingDashboardSchema } from '../../src/contracts/walking';

// Written for the real test database harness. Do not run while the user has
// restricted this task to code writing because of the host's memory pressure.
test.use({ actionTimeout: 12_000 });
test.beforeEach(async ({ request, baseURL }) => {
  expect((await request.post(baseURL + '/_test/reset-limits')).ok()).toBe(true);
});

async function account(request: APIRequestContext, origin: string, name: string) {
  const email = `walking-${randomUUID()}@example.test`;
  const password = 'Local-Only-' + randomUUID();
  const response = await request.post(origin + '/api/native/auth/sign-up/email', {
    data: { email, password, name, callbackURL: '/account' },
  });
  expect(response.ok()).toBe(true);
  const mail = await request.get(origin + '/_test/mail', { params: { email, purpose: 'verify' } });
  expect((await request.get((await mail.json()).url)).ok()).toBe(true);
  return { email, password };
}

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto('/account?returnTo=%2Fquests');
  await page.getByLabel('이메일', { exact: true }).fill(user.email);
  await page.getByLabel(/^비밀번호/).fill(user.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/quests$/);
  await expect(page.getByRole('heading', { name: '혼자 걷기', exact: true })).toBeVisible();
}

async function dashboard(page: Page) {
  const response = await page.request.get('/api/v1/me/walking');
  expect(response.ok()).toBe(true);
  return walkingDashboardSchema.parse(await response.json());
}

async function seed(page: Page, origin: string, steps: number) {
  const response = await page.request.post('/_test/walking', {
    headers: { Origin: origin },
    data: { action: 'seed', steps },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole('button', { name: '걸음·보상 새로고침', exact: true }).click();
  await expect(page.getByRole('button', { name: '걸음·보상 새로고침', exact: true })).toBeEnabled();
}

test('guest login return, private server HTML and another account never see the same dashboard', async ({
  page, request, baseURL, browser, context,
}) => {
  await page.goto('/quests');
  await expect(page.getByRole('link', { name: '로그인하고 퀘스트 시작하기' }))
    .toHaveAttribute('href', '/account?returnTo=%2Fquests');
  const user = await account(request, baseURL!, '걷기 기록 시험');
  await login(page, user);
  await seed(page, baseURL!, 4321);
  const mine = await dashboard(page);
  const serverContext = await browser.newContext({
    baseURL, javaScriptEnabled: false, storageState: await context.storageState(),
  });
  const guestContext = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const serverPage = await serverContext.newPage();
    const response = await serverPage.goto('/quests');
    expect(response?.headers()['cache-control']).toContain('private');
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(serverPage.getByRole('heading', { name: '혼자 걷기' })).toBeVisible();
    await expect(serverPage.getByRole('region', { name: '혼자 걷기' }).getByText('4,321걸음', { exact: true })).toHaveCount(2);
    await expect(serverPage.getByRole('button', { name: '오늘 4P 받기' })).toBeDisabled();
    const guestPage = await guestContext.newPage();
    const guestResponse = await guestPage.goto('/quests');
    expect(await guestResponse!.text()).not.toContain(mine.userId);
    await expect(guestPage.getByRole('link', { name: '로그인하고 퀘스트 시작하기' })).toBeVisible();
    await expect(guestPage.getByText('4,321걸음', { exact: true })).toHaveCount(0);
  } finally {
    await serverContext.close();
    await guestContext.close();
  }
  expect((await page.request.get('/api/v1/me/walking', { headers: { 'X-Cmon-User': randomUUID() } })).status()).toBe(409);
});

test('daily points grow progressively, cap at 10000 and remain stable after a Health correction', async ({ page, request, baseURL }) => {
  const user = await account(request, baseURL!, '하루 포인트 시험');
  await login(page, user);
  await seed(page, baseURL!, 5500);
  await page.getByRole('button', { name: '오늘 5P 받기', exact: true }).click();
  await expect(page.getByRole('button', { name: '오늘 받을 포인트 없음' })).toBeDisabled();
  expect((await dashboard(page)).balance).toBe(5);
  await seed(page, baseURL!, 6500);
  await page.getByRole('button', { name: '오늘 1P 받기', exact: true }).click();
  await expect(page.getByRole('button', { name: '오늘 받을 포인트 없음' })).toBeDisabled();
  await seed(page, baseURL!, 1000);
  const corrected = await dashboard(page);
  expect(corrected.days.find((day) => day.day === corrected.today)).toMatchObject({ steps: 1000, creditedSteps: 6500, availablePoints: 0, claimedPoints: 6 });
  const daily = page.getByRole('region', { name: '혼자 걷기' });
  await expect(daily.getByText('1,000걸음', { exact: true })).toBeVisible();
  await expect(daily.getByText('6,500걸음', { exact: true })).toBeVisible();
  await seed(page, baseURL!, 25000);
  await page.getByRole('button', { name: '오늘 4P 받기', exact: true }).click();
  await expect(page.getByRole('button', { name: '오늘 받을 포인트 없음' })).toBeDisabled();
  expect((await dashboard(page)).balance).toBe(10);
  await page.getByRole('button', { name: '새싹 산책가 5P로 교환', exact: true }).click();
  await expect(page.getByRole('button', { name: '새싹 산책가 보유 중', exact: true })).toBeDisabled();
  const redeemed = await dashboard(page);
  expect(redeemed.balance).toBe(5);
  expect(redeemed.catalog.find((badge) => badge.id === 'sprout')?.owned).toBe(true);
  expect(redeemed.ledger.filter((entry) => entry.amount < 0).map((entry) => entry.amount)).toEqual([-5]);
});

test('a lost successful response is recovered by lookup after reload without another claim', async ({ page, request, baseURL }) => {
  const user = await account(request, baseURL!, '응답 복구 시험');
  await login(page, user);
  await seed(page, baseURL!, 6000);
  let writes = 0;
  let commandId = '';
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/walking/commands') writes++;
  });
  await page.route('**/api/v1/walking/commands', async (route) => {
    commandId = route.request().headers()['idempotency-key'];
    expect(route.request().headers()['x-cmon-user']).toBe((await dashboard(page)).userId);
    await route.fetch();
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '오늘 6P 받기', exact: true }).click();
  await expect(page.getByRole('button', { name: '저장 결과 확인', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '오늘 6P 받기', exact: true })).toBeDisabled();
  await page.unroute('**/api/v1/walking/commands');
  await page.reload();
  await expect(page.getByRole('button', { name: '오늘 받을 포인트 없음', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '저장 결과 확인', exact: true })).toHaveCount(0);
  expect(writes).toBe(1);
  expect((await dashboard(page)).balance).toBe(6);
  const result = await page.request.get('/api/v1/me/walking-commands/' + commandId);
  expect((await result.json()).id).toBeTruthy();
  expect(await page.evaluate((id) => Object.values(localStorage).some((value) => value.includes(id)), commandId)).toBe(false);
});

test('a request that did not reach the server keeps its key for an explicit retry', async ({ page, request, baseURL }) => {
  const user = await account(request, baseURL!, '미전송 복구 시험');
  await login(page, user);
  await seed(page, baseURL!, 3000);
  let commandId = '';
  await page.route('**/api/v1/walking/commands', async (route) => {
    commandId = route.request().headers()['idempotency-key'];
    await route.abort('failed');
  });
  await page.getByRole('button', { name: '오늘 3P 받기', exact: true }).click();
  await expect(page.getByRole('button', { name: '같은 요청 다시 보내기' })).toBeEnabled();
  await page.reload();
  await expect(page.getByText(/아직 저장 결과가 없습니다/)).toBeVisible();
  await page.unroute('**/api/v1/walking/commands');
  await page.route('**/api/v1/walking/commands', async (route) => {
    expect(route.request().headers()['idempotency-key']).toBe(commandId);
    await route.continue();
  });
  await page.getByRole('button', { name: '같은 요청 다시 보내기' }).click();
  await expect(page.getByRole('button', { name: '오늘 받을 포인트 없음' })).toBeDisabled();
  expect((await dashboard(page)).balance).toBe(3);
});

test('a temporary expedition is shared by invitation, shows contributors and supports leaving', async ({ page, request, baseURL, browser }, info) => {
  test.setTimeout(60_000);
  const host = await account(request, baseURL!, '원정 개설 시험');
  const companion = await account(request, baseURL!, '원정 동료 시험');
  await login(page, host);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const title = '길고긴 원정 이름도 작은 화면에서 함께 읽는 동네 산책 ' + randomUUID().slice(0, 8);
  await page.getByLabel('원정 이름', { exact: true }).fill(title);
  await page.getByRole('button', { name: '원정 만들기', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const code = await page.getByLabel('이 원정의 초대 코드', { exact: true }).inputValue();
  expect(code).toMatch(/^[A-Z0-9]{12}$/);
  const first = (await dashboard(page)).expeditions[0];
  expect(first.state).toBe('recruiting');
  expect((Date.parse(first.endsOn) - Date.parse(first.startsOn)) / 86400000).toBe(7);
  await expect(page.getByRole('button', { name: '원정 만들기', exact: true })).toHaveCount(0);
  const companionContext = await browser.newContext({ baseURL });
  try {
    const companionPage = await companionContext.newPage();
    await login(companionPage, companion);
    await companionPage.getByLabel('초대 코드', { exact: true }).fill(code.toLowerCase());
    await companionPage.getByRole('button', { name: '원정 참여하기', exact: true }).click();
    await expect(companionPage.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await page.getByRole('button', { name: '걸음·보상 새로고침', exact: true }).click();
    await expect(page.getByText('모집 중 · 2/5명', { exact: true })).toBeVisible();
    await page.getByText('동료가 보탠 걸음', { exact: true }).click();
    await expect(page.getByRole('list', { name: title + ' 동료' })).toContainText('원정 개설 시험 (나)');
    await expect(page.getByRole('list', { name: title + ' 동료' })).toContainText('원정 동료 시험');
    await expect(page.getByRole('button', { name: '출발 지점 5P 받기', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('walking-320-text-200.png'), fullPage: true });
    await expect(page.getByRole('link', { name: '커뮤니티에 공개 산책 후기 쓰기' })).toHaveAttribute('href', '/community/new');
    await companionPage.getByRole('button', { name: '원정 나가기', exact: true }).click();
    await companionPage.getByRole('button', { name: '원정 나가기 확정', exact: true }).click();
    await expect(companionPage.getByRole('button', { name: '원정 만들기', exact: true })).toBeEnabled();
    expect((await dashboard(companionPage)).expeditions).toHaveLength(0);
    await companionPage.getByLabel('초대 코드', { exact: true }).fill(code);
    await companionPage.getByRole('button', { name: '원정 참여하기', exact: true }).click();
    await expect(companionPage.getByRole('heading', { name: title, exact: true })).toBeVisible();
  } finally {
    await companionContext.close();
  }
});

test('dashboard loading errors retry and native embedding omits the web navigation', async ({ page, request, baseURL }) => {
  const user = await account(request, baseURL!, '연결 오류 시험');
  await login(page, user);
  await page.route('**/api/v1/me/walking', (route) => route.abort('failed'));
  await page.getByRole('button', { name: '걸음·보상 새로고침', exact: true }).click();
  await expect(page.getByRole('button', { name: '퀘스트 다시 조회' })).toBeVisible();
  await expect(page.getByRole('button', { name: '원정 만들기', exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/me/walking');
  await page.getByRole('button', { name: '퀘스트 다시 조회' }).click();
  await expect(page.getByRole('heading', { name: '혼자 걷기' })).toBeVisible();
  await page.goto('/quests?surface=native');
  await expect(page.getByRole('navigation', { name: '주 메뉴' })).toHaveCount(0);
  await expect(page.getByText(/앱의 걷기 탭에서 HealthKit/)).toBeVisible();
});

test('a late dashboard from the previous account is discarded across tabs', async ({ page, request, baseURL, context }) => {
  test.setTimeout(60_000);
  const first = await account(request, baseURL!, '이전 걷기 계정 시험');
  const second = await account(request, baseURL!, '다음 걷기 계정 시험');
  await login(page, first);
  await seed(page, baseURL!, 8765);
  let release = () => {};
  let captured = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const capture = new Promise<void>((resolve) => { captured = resolve; });
  await page.route('**/api/v1/me/walking', async (route) => {
    const response = await route.fetch();
    captured();
    await gate;
    try { await route.fulfill({ response }); }
    catch { /* Changing accounts cancels the old private request. */ }
  });
  const other = await context.newPage();
  try {
    await page.getByRole('button', { name: '걸음·보상 새로고침', exact: true }).click();
    await capture;
    await other.goto('/account');
    await other.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(page.getByRole('link', { name: '로그인하고 퀘스트 시작하기' })).toBeVisible();
    await login(other, second);
    release();
    await page.unroute('**/api/v1/me/walking');
    await page.reload();
    await expect(page.getByText('8,765걸음', { exact: true })).toHaveCount(0);
    await expect(page.getByText('아직 기록 없음', { exact: true })).toBeVisible();
    expect((await dashboard(page)).balance).toBe(0);
    expect((await dashboard(page)).days).toHaveLength(0);
  } finally {
    release();
    await other.close();
  }
});
