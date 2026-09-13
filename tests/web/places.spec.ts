import { test, expect } from '@playwright/test';
const id = 'park-46840-00023';

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
  await page.getByRole('button', { name: '시설·날씨 새로고침' }).click();
  await expect(page.getByText('날씨 갱신에 실패했습니다. 이전에 받은 예보입니다.')).toBeVisible();
  await state('normal');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('최근에 받은 예보입니다.')).toBeVisible();
  await state('not-found');
  await page.getByRole('button', { name: '시설·날씨 새로고침' }).click();
  await expect(page.getByText('시설을 찾을 수 없습니다.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '근린공원 36', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '단기예보' })).toHaveCount(0);
  await state('changed');
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(
    page.getByRole('heading', { name: '[QA] HTTP로 갱신된 공원', exact: true }),
  ).toBeVisible();
  await state('disconnect');
  await page.getByRole('button', { name: '시설·날씨 새로고침' }).click();
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
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('날씨를 불러오지 못했습니다. 다시 시도해 주세요.')).toBeVisible();
  await state('normal');
  await page.getByRole('button', { name: '다시 시도' }).click();
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
