import { test, expect } from './fixtures';
const id = 'park-46840-00023';

test('facility search narrows real rows, explains no results and preserves navigation', async ({
  page,
}) => {
  await page.goto('/places');
  const search = page.getByRole('searchbox', { name: '시설 이름·주소 검색' });
  await search.fill('근린공원 36');
  await expect(page.getByRole('link', { name: '근린공원 36', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '남악공원', exact: true })).toHaveCount(0);
  await search.fill('검색 결과가 없는 이름');
  await expect(
    page.getByRole('status').filter({ hasText: '검색한 이름·주소의 시설이 없습니다.' }),
  ).toBeVisible();
  await search.fill('근린공원 36');
  await page.getByRole('link', { name: '근린공원 36', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: '근린공원 36', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '시설 목록으로 돌아가기', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
});

test('HTTP client rejects malformed success data without replacing the last valid detail, then recovers', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/places')) requests++;
  });
  await page.goto(`/places/${id}`);
  const retry = page.getByRole('button', { name: '시설 새로고침', exact: true });
  await expect(retry).toBeEnabled();
  expect(requests).toBe(0);
  // An intercepted HTTP response represents a backend contract regression.
  // The initial and recovered contents still come from the real DB-backed server.
  await page.route(`**/api/v1/places/${id}/info`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ place: { name: 'INVALID_RESPONSE_MUST_NOT_REPLACE_DETAIL' } }),
    }),
  );
  await retry.click();
  await expect(page.getByRole('alert')).toHaveText(
    '시설을 불러오지 못했습니다. 다시 시도해 주세요.',
  );
  await expect(
    page.getByText('이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '근린공원 36', exact: true })).toBeVisible();
  await expect(page.getByText('INVALID_RESPONSE_MUST_NOT_REPLACE_DETAIL')).toHaveCount(0);
  expect(requests).toBe(1);
  await page.unroute(`**/api/v1/places/${id}/info`);
  await retry.click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByText('이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.'),
  ).toHaveCount(0);
  expect(requests).toBe(2);
  expect(errors).toEqual([]);
});

test('DB-backed facilities SSR without JS and hydration without an initial duplicate request', async ({
  browser,
  page,
  baseURL,
}) => {
  const noJS = await browser.newContext({ javaScriptEnabled: false });
  const serverPage = await noJS.newPage();
  await serverPage.goto(baseURL + `/places/${id}`);
  await expect(serverPage).toHaveTitle("C'mon Yo! · 시설");
  await expect(serverPage.getByRole('heading', { name: '근린공원 36', exact: true })).toBeVisible();
  await expect(serverPage.getByText('풋살장 · 인라인스케이트장 · 농구장')).toBeVisible();
  await noJS.close();
  let requests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/places')) requests++;
  });
  await page.goto('/places');
  await expect(page.getByRole('button', { name: '시설 새로고침' })).toBeEnabled();
  expect(requests).toBe(0);
  await expect(page.getByRole('link', { name: '남악어린이공원8', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '시설 새로고침' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => requests).toBe(1);
  await page.getByRole('link', { name: '근린공원 36', exact: true }).click();
  await expect(page.getByRole('heading', { name: '근린공원 36', exact: true })).toBeVisible();
  await expect(page.getByText('날씨를 불러오지 못했습니다. 다시 시도해 주세요.')).toBeVisible();
});

test('local HTTP QA: fresh/stale/unavailable, 404, disconnect, retry and small-screen layout', async ({
  page,
  request,
}) => {
  const origin = 'http://127.0.0.1:3112';
  const state = async (value: string) => {
    expect((await request.put(`${origin}/_test/state/${value}`)).ok()).toBe(true);
  };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.text().includes('Hydration')) errors.push(message.text());
  });
  await state('reset');
  await page.goto(`${origin}/places/${id}`);
  await expect(page.getByText('최근에 받은 예보입니다.')).toBeVisible();
  await state('weather-error');
  await page.getByRole('button', { name: '날씨 다시 조회' }).click();
  await expect(page.getByText('날씨 갱신에 실패했습니다. 이전에 받은 예보입니다.')).toBeVisible();
  await state('normal');
  await page.getByRole('button', { name: '날씨 다시 조회' }).click();
  await expect(page.getByText('최근에 받은 예보입니다.')).toBeVisible();
  await state('not-found');
  await page.getByRole('button', { name: '시설 새로고침' }).click();
  await expect(page.getByText('시설을 찾을 수 없습니다.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '근린공원 36', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '단기예보' })).toHaveCount(0);
  await state('changed');
  await page.getByRole('button', { name: '시설 새로고침' }).click();
  await expect(
    page.getByRole('heading', { name: '[QA] HTTP로 갱신된 공원', exact: true }),
  ).toBeVisible();
  await state('disconnect');
  await page.getByRole('button', { name: '시설 새로고침' }).click();
  await page.getByRole('button', { name: '날씨 다시 조회' }).click();
  await expect(
    page.getByText('이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.'),
  ).toBeVisible();
  await expect(page.getByText('날씨 갱신에 실패했습니다. 이전에 받은 예보입니다.')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await state('reset');
  await state('weather-timeout');
  await page.getByRole('button', { name: '시설 새로고침' }).click();
  await page.getByRole('button', { name: '날씨 다시 조회' }).click();
  await expect(page.getByText('날씨를 불러오지 못했습니다. 다시 시도해 주세요.')).toBeVisible();
  await state('normal');
  await page.getByRole('button', { name: '날씨 다시 조회' }).click();
  await expect(page.getByText('최근에 받은 예보입니다.')).toBeVisible();
  await expect(
    page.getByText('이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.'),
  ).toHaveCount(0);
  await state('empty');
  await page.goto(`${origin}/places`);
  await expect(page.getByText('등록된 시설 정보가 없습니다.')).toBeVisible();
  await state('error');
  await page.reload();
  await expect(page.getByRole('heading', { name: '시설을 불러오지 못했습니다.' })).toBeVisible();
  await state('normal');
  await page.getByRole('link', { name: '다시 시도', exact: true }).click();
  await expect(page.getByRole('link', { name: '근린공원 36', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('map pins follow search and keyboard selection opens the matching facility detail', async ({
  page,
}) => {
  await page.goto('/places');
  const map = page.getByRole('region', { name: '공원과 운동시설 지도' });
  const search = page.getByRole('searchbox', { name: '시설 이름·주소 검색' });
  await expect(map.getByRole('button', { name: /지도 핀$/ })).toHaveCount(21);
  await expect(page.getByText('지도를 불러오는 중… 시설 목록도 이용할 수 있습니다.')).toHaveCount(
    0,
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await search.fill('근린공원 36');
  await expect(map.getByRole('button', { name: /지도 핀$/ })).toHaveCount(1);
  const pin = map.getByRole('button', { name: '근린공원 36 지도 핀', exact: true });
  await pin.focus();
  await page.keyboard.press('Enter');
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('선택한 시설')).toContainText('일로읍 오남로 55');
  await page.getByRole('link', { name: '시설 상세 보기', exact: true }).click();
  await expect(page).toHaveURL(/\/places\/park-46840-00023$/);
  await expect(
    page.getByRole('heading', { level: 1, name: '근린공원 36', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '시설 목록으로 돌아가기' }).click();
  await expect(map.getByRole('button', { name: /지도 핀$/ })).toHaveCount(21);
  await search.fill('해당 시설 없음');
  await expect(map.getByRole('button', { name: /지도 핀$/ })).toHaveCount(0);
  await expect(page.getByLabel('선택한 시설')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: '검색한 이름·주소의 시설이 없습니다.' }),
  ).toBeVisible();
});

test('device location permission adds the actual position marker without hiding facilities', async ({
  page,
  baseURL,
}) => {
  await page.context().grantPermissions(['geolocation'], { origin: baseURL });
  await page.context().setGeolocation({ latitude: 37.5665, longitude: 126.978 });
  await page.goto('/places');
  await expect(page.getByRole('img', { name: '현재 위치' })).toBeVisible();
  await expect(page.getByRole('button', { name: '내 위치 찾기' })).toBeVisible();
  await expect(page.getByRole('link', { name: '근린공원 36', exact: true })).toBeVisible();
});

test('tile failure leaves facility access intact and map retry recovers', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.goto('/places');
  await expect(page.getByRole('alert')).toContainText('지도 배경을 불러오지 못했습니다.');
  await expect(page.getByRole('link', { name: '근린공원 36', exact: true })).toBeVisible();
  await page.unroute('https://tiles.openfreemap.org/**');
  await page.getByRole('button', { name: '지도 다시 불러오기' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const pin = page.getByRole('button', { name: '운남공원 지도 핀', exact: true });
  await pin.click();
  await expect(page.getByLabel('선택한 시설')).toContainText('운남공원');
  await page.getByRole('button', { name: '전체 핀 보기' }).click();
  await expect(page.getByLabel('선택한 시설')).toHaveCount(0);
});
