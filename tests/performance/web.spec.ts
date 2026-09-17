import { test, expect, type BrowserContext } from '../web/fixtures';
const id = 'park-46840-00023';
test('the related meeting link works while the original SSR weather stream is still held', async ({
  page,
  request,
}) => {
  await request.post('/_perf/control', {
    data: { mode: 'hold', reset: true, weatherDeadlineMs: 30000 },
  });
  const errors: string[] = [];
  let documents = 0;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/Hydration|hydration|Encountered a script tag/.test(m.text()) && m.type() === 'error')
      errors.push(m.text());
  });
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents++;
  });
  try {
    await page.goto('/places/' + id, { waitUntil: 'commit' });
    await expect(page.getByRole('button', { name: '시설 새로고침' })).toBeEnabled();
    await expect(page.getByText('날씨를 불러오는 중…')).toBeVisible();
    await page.getByRole('link', { name: '이 장소의 모임 보기', exact: true }).click();
    await expect(
      page.getByRole('link', { name: '[성능 시험] 운동 약속 01', exact: true }),
    ).toBeVisible();
    await request.post('/_perf/control', { data: { mode: 'normal', release: true } });
    await page.waitForLoadState('load');
    await expect(page.getByRole('heading', { name: '같이 운동할 모임' })).toBeVisible();
    await expect(page.locator('section[aria-label="날씨"]')).toHaveCount(0);
    expect(documents).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await request.post('/_perf/control', { data: { mode: 'normal', release: true } });
  }
});
test('a public SSR list does not mistake an unchecked signed-in viewer for an anonymous account', async ({
  page,
  request,
  baseURL,
}) => {
  await request.post('/_perf/control', { data: { resetAuth: true } });
  const setup = await (await request.get('/_perf/setup')).json();
  expect(
    (
      await page.request.post('/api/auth/sign-in/email', {
        headers: { origin: baseURL! },
        data: setup.users[1],
      })
    ).ok(),
  ).toBe(true);
  let documents = 0;
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents++;
  });
  await page.goto('/meetups');
  await page.getByRole('link', { name: '[성능 시험] 운동 약속 01', exact: true }).click();
  await expect(page.getByRole('button', { name: '참여하기', exact: true })).toBeEnabled();
  expect(documents).toBe(1);
});
test('hydration preserves an already scrolled SSR list and reuses its facility record', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/assets/entry-client-*.js', async (route) => {
    await held;
    await route.continue();
  });
  const infoRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/info')) infoRequests.push(r.url());
  });
  await page.goto('/places', { waitUntil: 'commit' });
  const facility = page.locator('main ul').getByRole('link').last();
  const facilityName = await facility.getByRole('heading').innerText();
  await facility.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  expect(scroll).toBeGreaterThan(0);
  release();
  await expect(page.getByRole('button', { name: '시설 새로고침' })).toBeEnabled();
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  await facility.click();
  await expect(page.getByRole('heading', { name: facilityName, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '날씨 다시 조회' })).toBeEnabled();
  expect(infoRequests).toEqual([]);
});
test('production streamed weather, independent recovery, late navigation and cache restoration', async ({
  page,
  request,
}, info) => {
  const control = async (data: object) =>
    expect((await request.post('/_perf/control', { data })).ok()).toBe(true);
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (/Hydration|hydration|Encountered a script tag/.test(m.text()) && m.type() === 'error')
      errors.push(m.text());
  });
  let documents = 0;
  page.on('request', (r) => {
    requests.push(r.url());
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documents++;
  });
  await control({ mode: 'hold', weatherDeadlineMs: 30000, reset: true, metrics: true });
  await page.goto('/places/' + id, { waitUntil: 'commit' });
  const body = page.getByRole('heading', { name: '근린공원 36', exact: true });
  await expect(body).toBeVisible();
  await expect(page.getByText('풋살장 · 인라인스케이트장 · 농구장')).toBeVisible();
  const related = page.getByRole('link', { name: '이 장소의 모임 보기', exact: true });
  await expect(related).toBeVisible();
  await expect(page.getByText('날씨를 불러오는 중…')).toBeVisible();
  await related.focus();
  await page.screenshot({ path: info.outputPath('body-before-weather.png') });
  await control({ mode: 'normal', release: true });
  await expect(page.getByText('최근에 받은 예보입니다.')).toBeVisible();
  await expect(related).toBeFocused();
  await expect(page.locator('section[aria-label="날씨"]')).toHaveCount(1);
  // Personal favorites load independently; public facility and weather data
  // must still come from the streamed response without duplicate API reads.
  expect(
    requests.filter(
      (u) => u.includes('/api/') && new URL(u).pathname !== '/api/v1/me/place-favorites',
    ),
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath('weather-released.png') });
  // Retry changes just the weather query. Facility node and focus survive.
  await body.evaluate((e) => e.setAttribute('data-same-node', 'yes'));
  await control({ mode: 'failure', reset: true });
  await page.getByRole('button', { name: '날씨 다시 조회' }).click();
  await expect(page.getByText('날씨를 불러오지 못했습니다. 다시 시도해 주세요.')).toBeVisible();
  await control({ mode: 'normal', reset: true });
  await page.getByRole('button', { name: '날씨 다시 조회' }).click();
  await expect(page.getByText('최근에 받은 예보입니다.')).toBeVisible();
  await expect(body).toHaveAttribute('data-same-node', 'yes');
  await expect(page.getByRole('button', { name: '날씨 다시 조회' })).toBeFocused();
  expect(requests.filter((u) => u.endsWith('/info'))).toEqual([]);
  // The actual related link remains usable while another weather request is held.
  await control({ mode: 'hold', reset: true });
  await page.getByRole('button', { name: '날씨 다시 조회' }).click();
  await expect(page.getByText('날씨를 갱신하는 중…')).toBeVisible();
  await expect(page.getByRole('button', { name: '날씨 다시 조회' })).toBeFocused();
  await related.click();
  await expect(page.getByRole('heading', { name: '같이 운동할 모임' })).toBeVisible();
  await page.getByRole('link', { name: '둘러보기', exact: true }).click();
  const another = page.getByRole('link', { name: '남악공원', exact: true });
  await another.click();
  await control({ mode: 'normal', release: true });
  await expect(page.getByRole('heading', { name: '남악공원', exact: true })).toBeVisible();
  await expect(page.getByText('최근에 받은 예보입니다.')).toBeVisible();
  await expect(body).toHaveCount(0);
  // Query-keyed page/filter state and browser history scroll restoration.
  await page.getByRole('link', { name: '모임', exact: true }).click();
  await page.getByRole('combobox', { name: '종목', exact: true }).selectOption('walking');
  await page.getByRole('button', { name: '조건 적용' }).click();
  await page.getByRole('link', { name: '다음 페이지' }).click();
  const listURL = page.url();
  const last = page.getByRole('link', { name: '[성능 시험] 운동 약속 40', exact: true });
  await last.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await last.click();
  await expect(
    page.getByRole('heading', { name: '[성능 시험] 운동 약속 40', exact: true }),
  ).toBeVisible();
  const count = requests.filter((u) => u.includes('/api/v1/meetups?')).length;
  await page.goBack();
  await expect(page).toHaveURL(listURL);
  await expect(page.getByRole('combobox', { name: '종목', exact: true })).toHaveValue('walking');
  await expect(last).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  expect(requests.filter((u) => u.includes('/api/v1/meetups?')).length).toBe(count);
  expect(documents).toBe(1);
  expect(errors).toEqual([]);
  const js = requests.find((u) => /entry-client-.*\.js$/.test(u))!;
  const css = requests.find((u) => /assets\/.*\.css$/.test(u))!;
  for (const asset of [js, css])
    expect((await request.get(asset)).headers()['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
  expect(requests.some((u) => /AccountPage-.*\.js$|MeetingEditor-.*\.js$/.test(u))).toBe(false);
});

test('public meeting shell with held personal state stays request-isolated and hydrates once', async ({
  browser,
  request,
  baseURL,
}) => {
  const setup = await (await request.get('/_perf/setup')).json();
  await request.post('/_perf/control', { data: { holdMembership: true, resetAuth: true } });
  const contexts: BrowserContext[] = await Promise.all(
    setup.users.map(async (user: { email: string; password: string }) => {
      const context = await browser.newContext({ baseURL });
      expect(
        (
          await context.request.post('/api/auth/sign-in/email', {
            headers: { origin: baseURL! },
            data: user,
          })
        ).ok(),
      ).toBe(true);
      return context;
    }),
  );
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()));
  const calls: string[] = [],
    errors: string[] = [];
  for (const page of [host, guest]) {
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (/Hydration|hydration|Encountered a script tag/.test(m.text()) && m.type() === 'error')
        errors.push(m.text());
    });
  }
  try {
    await Promise.all(
      [host, guest].map((p) => p.goto('/meetups/' + setup.ids[0], { waitUntil: 'commit' })),
    );
    for (const page of [host, guest]) {
      await expect(
        page.getByRole('heading', { name: '[성능 시험] 운동 약속 01', exact: true }),
      ).toBeVisible();
      await expect(page.getByText('참여 상태를 확인하는 중…')).toBeVisible();
      await expect(page.getByRole('button', { name: '참여하기', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '모임 수정', exact: true })).toHaveCount(0);
    }
    await request.post('/_perf/control', { data: { holdMembership: false, releaseViewers: true } });
    await expect(host.getByRole('button', { name: '모임 수정', exact: true })).toBeEnabled();
    await expect(guest.getByRole('button', { name: '참여하기', exact: true })).toBeEnabled();
    await expect(guest.getByText('내가 주최한 모임입니다.')).toHaveCount(0);
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await request.post('/_perf/control', { data: { holdMembership: false, releaseViewers: true } });
    await Promise.all(contexts.map((c) => c.close()));
  }
});
