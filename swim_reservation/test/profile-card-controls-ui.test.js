import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { mockBookApp } from './fixtures/ui-book-app.js';
const executablePath = [process.env.CHROMIUM_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
test('추가 예약자도 입금자명 선택 안내를 표시하고 ×는 우상단, +는 마지막 카드 아래 중앙에 배치한다', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const state = await mockBookApp(page);
    await page.evaluate(() => switchWorkspaceTab('profiles-parallel'));
    await page.locator('#addProfileButton').click();
    assert.match(await page.locator('#depositorName2').locator('..').textContent(), /입금자명 \(선택\)/);
    assert.equal(await page.locator('#depositorName2').getAttribute('placeholder'), '미입력 시 예약자명');
    const panel = page.locator('#extraProfiles > .second-profile-panel').last();
    const card = await panel.boundingBox(), remove = await panel.locator('.profile-remove-button').boundingBox();
    const plus = await page.locator('#addProfileButton').boundingBox();
    assert.ok(remove.x > card.x + card.width / 2 && remove.y < card.y + 50);
    assert.ok(remove.width >= 44 && remove.height >= 44);
    assert.ok(Math.abs(plus.x + plus.width / 2 - card.x - card.width / 2) < 2);
    assert.ok(Math.abs(plus.y + plus.height / 2 - card.y - card.height) < 3);
    await page.evaluate(() => { window.confirm = () => { throw new Error('Native dialog blocked'); }; });
    await panel.locator('.profile-remove-button').click();
    await page.locator('#profileRemoveCancel').click();
    assert.equal(await page.locator('#extraProfiles > .second-profile-panel').count(), 1);
    await panel.locator('.profile-remove-button').click();
    await page.locator('#profileRemoveConfirm').click();
    assert.equal(await page.locator('#extraProfiles > .second-profile-panel').count(), 0);
    assert.equal(await page.locator('#excludeFirstProfile').isVisible(), false);
    assert.equal(state.book.length, 2);
    assert.ok(state.writes.every(path => path === '/api/inspect'));
    assert.deepEqual(state.errors, []);
    await page.close();
  }
});
