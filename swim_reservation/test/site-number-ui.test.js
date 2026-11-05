import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mockBookApp } from './fixtures/ui-book-app.js';

test('애드온 모든 예약 방식은 최신 링크 번호를 표시하고 저장할 이름은 유지한다', async t => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  const state = await mockBookApp(page);
  // Deliberately differ from configured order and then change a number.
  let entries = [{ name: '해_하늘존', siteId: 42 }, { name: '달_하늘존', siteId: 7 }];
  await page.route('https://app.test/api/site-identities', route => route.fulfill({ json: { entries } }));
  for (const mode of ['priority', 'multiple', 'profiles-parallel', 'watch']) {
    await page.evaluate(mode => {
      switchWorkspaceTab(mode);
      elements.startDate.value = '2027-01-27'; elements.nights.value = '1'; updateStayFields();
    }, mode);
    await page.evaluate(() => refreshAvailability());
    const picker = page.locator(mode === 'profiles-parallel' ? '#profilePriorities .site-choice-editor' : '#roomList').first();
    await picker.getByRole('button', { name: '사이트 선택', exact: true, includeHidden: true }).dispatchEvent('click');
    const dialog = page.locator('.site-choice-dialog');
    assert.equal(await dialog.locator('input[value="해_하늘존"]').getAttribute('aria-label'), '42 해');
    assert.equal(await dialog.locator('input[value="달_하늘존"]').getAttribute('aria-label'), '7 달');
    await dialog.locator('input[value="해_하늘존"]').check();
    await dialog.getByRole('button', { name: '완료', exact: true }).click();
    assert.match(await picker.locator('[data-choice-name="해_하늘존"]').innerText(), /42 해/);
    assert.ok(await page.evaluate(() => JSON.stringify(readConfig()).includes('해_하늘존')));
  }
  entries = [{ name: '해_하늘존', siteId: 99 }, { name: '달_하늘존', siteId: 42 }];
  await page.evaluate(() => refreshAvailability());
  assert.equal(await page.evaluate(() => siteChoiceLabel('해_하늘존')), '99 해');
  assert.equal(await page.evaluate(() => siteChoiceLabel('달_하늘존')), '42 달');
  assert.equal(await page.evaluate(() => siteChoiceLabel('미확인_하늘존')), '미확인');
  assert.deepEqual(state.errors, []);
  assert.equal(state.planCalls.length, 0);
});
