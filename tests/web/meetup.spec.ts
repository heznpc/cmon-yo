import { test, expect } from './fixtures';
import { mkdir } from 'node:fs/promises';
import fixture from '../../contracts/fixtures/meetup.json' with { type: 'json' };
import malicious from '../../contracts/fixtures/malicious.json' with { type: 'json' };
const path = `/meetups/${fixture.meetup.id}`;
test('refresh 404 removes previous detail and actions until a successful retry', async ({
  page,
}) => {
  await page.goto(path);
  const title = page.getByRole('heading', { name: fixture.meetup.title });
  const guide = page.getByRole('link', { name: '읽기 전용 모임 안내' });
  await expect(title).toBeVisible();
  await expect(guide).toBeVisible();
  await page.route('**/api/v1/meetups/*', (route) => route.fulfill({ status: 404, json: {} }));
  await page.getByRole('button', { name: '모임 새로고침' }).click();
  await expect(page.getByRole('alert')).toHaveText('모임을 찾을 수 없습니다.');
  await expect(title).toHaveCount(0);
  await expect(guide).toHaveCount(0);
  await expect(page.getByText(fixture.meetup.place.name, { exact: true })).toHaveCount(0);

  // A failed retry must not revive the detail invalidated by the 404.
  await page.route('**/api/v1/meetups/*', (route) => route.abort());
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('alert')).toContainText('연결에 실패');
  await expect(title).toHaveCount(0);
  await expect(guide).toHaveCount(0);
  await page.route('**/api/v1/meetups/*', (route) =>
    route.fulfill({
      json: { ...fixture, meetup: { ...fixture.meetup, title: '[Fixture] 복구된 최신 모임' } },
    }),
  );
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('heading', { name: '[Fixture] 복구된 최신 모임' })).toBeVisible();
  await expect(guide).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('refresh connection failure labels retained detail through retry and clears on success', async ({
  page,
}) => {
  await page.goto(path);
  await page.route('**/api/v1/meetups/*', (route) => route.abort());
  await page.getByRole('button', { name: '모임 새로고침' }).click();
  await expect(page.getByRole('alert')).toContainText('연결에 실패');
  const stale = page.getByText('이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.', {
    exact: true,
  });
  await expect(stale).toBeVisible();
  await expect(page.getByRole('heading', { name: fixture.meetup.title })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/v1/meetups/*', async (route) => {
    await gate;
    await route.fulfill({
      json: { ...fixture, meetup: { ...fixture.meetup, title: '[Fixture] 재조회 최신 모임' } },
    });
  });
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('모임을 불러오는 중…')).toBeVisible();
  await expect(stale).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: '[Fixture] 재조회 최신 모임' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(stale).toHaveCount(0);
  await expect(page.getByRole('link', { name: '읽기 전용 모임 안내' })).toBeVisible();
});
test('JavaScript disabled: SSR title, time and place are visible body content', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(baseURL + path);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: fixture.meetup.title })).toBeVisible();
  await expect(page.getByText('2026년 9월 20일 10:00', { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.meetup.place.name, { exact: true })).toBeVisible();
  await context.close();
});
test('hydration has zero initial API requests; keyboard refresh, changed HTTP and failure/retry', async ({
  page,
}, info) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error' && !e.text().includes('Failed to load resource'))
      errors.push(e.text());
  });
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/meetups/')) requests.push(r.url());
  });
  await page.goto(path);
  await expect(page).toHaveTitle("C'mon Yo! · 모임");
  const refresh = page.getByRole('button', { name: '모임 새로고침' });
  await expect(refresh).toBeEnabled();
  await page.waitForTimeout(750);
  expect(requests).toHaveLength(0);
  await refresh.focus();
  await expect(refresh).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => requests.length).toBe(1);
  await expect(refresh).toBeEnabled();
  await page.route('**/api/v1/meetups/*', (route) =>
    route.fulfill({
      json: { ...fixture, meetup: { ...fixture.meetup, title: '[Fixture] 바뀐 HTTP 제목' } },
    }),
  );
  await refresh.click();
  await expect(page.getByRole('heading', { name: '[Fixture] 바뀐 HTTP 제목' })).toBeVisible();
  await page.route('**/api/v1/meetups/*', (route) => route.abort());
  await refresh.click();
  await expect(page.getByRole('alert')).toContainText('연결에 실패');
  await page.unroute('**/api/v1/meetups/*');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('heading', { name: fixture.meetup.title })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.route('**/api/v1/meetups/*', (route) => route.fulfill({ json: { meetup: {} } }));
  await refresh.click();
  await expect(page.getByRole('alert')).toHaveText('모임 응답을 읽을 수 없습니다.');
  await page.unroute('**/api/v1/meetups/*');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  await mkdir('/tmp/cmon-yo-qa', { recursive: true });
  await page.screenshot({
    path: `/tmp/cmon-yo-qa/${info.project.name}-desktop.png`,
    fullPage: true,
  });
});
test('404 and loading are rendered and recoverable', async ({ page }) => {
  const response = await page.goto('/meetups/33333333-3333-4333-8333-333333333333');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: '모임을 찾을 수 없습니다.' })).toBeVisible();
  await page.goto(path);
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/api/v1/meetups/*', async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: '모임 새로고침' }).click();
  await expect(page.getByText('모임을 불러오는 중…')).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: '모임 새로고침' })).toBeEnabled();
});
test('read-only discussion has browser fallback', async ({ page }) => {
  await page.goto(path);
  await page.getByRole('link', { name: '읽기 전용 모임 안내' }).click();
  await expect(page.getByText('읽기 전용 연결 시험입니다.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '모임 상세로 돌아가기' }).click();
  await expect(page).toHaveURL(new RegExp(path + '$'));
});
test('malicious SSR text remains text at 320px and 200% type size; touch target works', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(`http://127.0.0.1:${info.project.name === 'development' ? 3003 : 3004}${path}`);
  await expect(page.getByRole('heading', { name: malicious.meetup.title })).toBeVisible();
  await expect(page.getByRole('button', { name: '모임 새로고침' })).toBeEnabled();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await page.evaluate(() => 'pwned' in globalThis)).toBe(false);
  expect(await page.locator('img').count()).toBe(0);
  expect(errors).toEqual([]);
  const button = page.getByRole('button', { name: '모임 새로고침' });
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await button.click();
  await expect(button).toBeEnabled();
  await mkdir('/tmp/cmon-yo-qa', { recursive: true });
  await page.screenshot({
    path: `/tmp/cmon-yo-qa/${info.project.name}-small-large-text.png`,
    fullPage: true,
  });
});
test('bridge capabilities and correlated response render without duplicate sends', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      bridgeMessages: [],
      webkit: {
        messageHandlers: {
          cmonYo: {
            postMessage: async (message: { requestId: string; type: string }) => {
              (window as unknown as { bridgeMessages: unknown[] }).bridgeMessages.push(message);
              return {
                version: 1,
                requestId: message.requestId,
                status: 'ok',
                result: message.type === 'capabilities' ? { openMeetup: true } : { accepted: true },
              };
            },
          },
        },
      },
    });
  });
  await page.goto(path + '/discussion');
  await page.getByRole('button', { name: '앱 모임으로 돌아가기' }).click();
  await expect(page.getByText('앱이 복귀 요청을 수락했습니다.')).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { bridgeMessages: { type: string }[] }).bridgeMessages.map(
        (m) => m.type,
      ),
    ),
  ).toEqual(['capabilities', 'openMeetup']);
});
