import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('regions from imported data drive facility pages, meetup creation and community filters', async ({
  page,
  browser,
  request,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Anonymous viewer checks intentionally return 401 before sign-in.
    if (
      message.type() === 'error' &&
      !(message.location().url.endsWith('/api/v1/me') && message.text().includes('401'))
    )
      errors.push(message.text());
  });
  await request.post('/_test/reset-limits');
  const first = await (await request.get('/api/v1/places?regionCode=11680')).json();
  const last = await (await request.get('/api/v1/places?regionCode=11680&page=1')).json();
  expect(first.places).toHaveLength(100);
  expect(last.places.length).toBeGreaterThan(0);
  const park = last.places[0];
  const noJS = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const ssrPage = await noJS.newPage();
  await ssrPage.goto('/places?regionCode=11680&page=1');
  await expect(ssrPage.getByRole('link', { name: park.name, exact: true })).toBeVisible();
  await noJS.close();

  await page.goto('/places');
  await page.getByRole('combobox', { name: '동네', exact: true }).selectOption('11680');
  await page.getByRole('button', { name: '시설 조건 적용' }).click();
  await expect(page).toHaveURL(/regionCode=11680/);
  await page.getByRole('link', { name: '다음 시설 페이지' }).click();
  await page.getByRole('link', { name: park.name, exact: true }).click();
  await expect(page.getByRole('heading', { name: park.name, exact: true })).toBeVisible();

  const email = `region-${randomUUID()}@example.test`,
    password = 'Local-Only-' + randomUUID();
  expect(
    (
      await request.post('/api/native/auth/sign-up/email', {
        data: { email, password, name: '지역 시험', callbackURL: '/account' },
      })
    ).ok(),
  ).toBe(true);
  const mail = await (
    await request.get('/_test/mail', { params: { email, purpose: 'verify' } })
  ).json();
  expect((await request.get(mail.url)).ok()).toBe(true);
  await page.getByRole('link', { name: '이 장소에서 모임 만들기' }).click();
  await page.getByRole('link', { name: '로그인하고 계속하기' }).click();
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel(/^비밀번호/).fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '장소', exact: true })).toHaveValue(park.id);
  const title = '[지역 시험] 운동 약속 ' + randomUUID().slice(0, 8);
  await page.getByLabel('제목', { exact: true }).fill(title);
  const start = new Date(Date.now() + 172800000),
    end = new Date(start.getTime() + 3600000);
  await page.getByLabel('시작 날짜').fill(start.toISOString().slice(0, 10));
  await page.getByLabel('시작 시간').fill(start.toISOString().slice(11, 16));
  await page.getByLabel('종료 날짜').fill(end.toISOString().slice(0, 10));
  await page.getByLabel('종료 시간').fill(end.toISOString().slice(11, 16));
  await page.getByRole('button', { name: '모임 생성', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const id = new URL(page.url()).pathname.split('/').at(-1);
  expect((await (await request.get('/api/v1/meetups/' + id)).json()).meetup.regionCode).toBe(
    '11680',
  );
  await page.goto('/meetups?regionCode=46840');
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '동네', exact: true }).selectOption('11680');
  await page.getByRole('button', { name: '조건 적용', exact: true }).click();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();

  await page.goto('/community/new');
  await page.getByLabel('제목', { exact: true }).fill(title);
  await page.getByLabel('본문', { exact: true }).fill('다른 동네의 운동 질문입니다.');
  await page.getByRole('combobox', { name: '게시글 동네', exact: true }).selectOption('11680');
  await page.getByRole('button', { name: '게시글 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.goto('/community?regionCode=46840');
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '동네', exact: true }).selectOption('11680');
  await page.getByRole('button', { name: '조회', exact: true }).click();
  await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('regional-community-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});
