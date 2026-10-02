import { test, expect } from './fixtures';

test('a missing route chunk leaves a visible recovery action instead of a blank app', async ({ page }) => {
  await page.goto('/places');
  await page.route('**/*QuestsPage*', (route) => route.abort('failed'));
  await page.getByRole('link', { name: '퀘스트', exact: true }).click();
  await expect(page.getByRole('heading', { name: '화면을 표시하지 못했습니다.', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '화면 다시 불러오기', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '시설 목록으로 이동', exact: true }).click();
  await expect(page.getByRole('heading', { name: '공원과 운동시설', exact: true })).toBeVisible();
});
