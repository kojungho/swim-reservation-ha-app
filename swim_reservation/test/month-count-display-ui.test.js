import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { mockBookApp } from './fixtures/ui-book-app.js';
const executablePath = [process.env.CHROMIUM_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
test('월별 조회 시작·월 이동에 전체 사이트가 나타나지 않고 0·양수·오픈 전·미확인 색상과 한 줄 수량을 구분한다', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.clock.setFixedTime(new Date('2026-10-12T10:00:00+09:00')); const state = await mockBookApp(page);
    let release; let gate = new Promise(resolve => { release = resolve; }); let dayCalls = 0;
    await page.route(/\/api\/calendar-day\?/, route => { dayCalls++; return route.fulfill({ status: 500, json: { error: 'unexpected request' } }); });
    await page.route(/\/api\/month-cache$/, route => route.fulfill({ json: { intervalMinutes: 0 } }));
    await page.route(/\/api\/monthly-availability\?/, async route => {
      await gate; const month = new URL(route.request().url()).searchParams.get('month');
      return route.fulfill({ json: { month, countsOnly: true, roomNames: [], capturedAt: Date.now(), days: [0, 14, null, null].map((availableCount, i) => ({ date: `${month}-0${i + 1}`, availableCount, beforeOpen: i === 2, queryState: 'done', rooms: [] })) } });
    });
    await page.evaluate(() => { switchWorkspaceTab('monthly'); elements.monthlyMonth.value = '2026-11'; void loadMonthlyAvailability(); });
    await page.locator('.monthly-count.loading').first().waitFor();
    assert.equal(await page.locator('#monthlyContent .monthly-room-row').count(), 0);
    release(); await page.waitForFunction(() => !document.querySelector('#monthlyQueryButton').disabled);
    const first = page.locator('[data-date="2026-11-01"]');
    assert.equal(await first.locator('.monthly-count.booked').textContent(), '0곳');
    assert.match(await first.getAttribute('aria-label'), /예약 가능 0곳.*잔여 없음/);
    assert.equal(await page.locator('[data-date="2026-11-02"] .monthly-count.available').textContent(), '14곳');
    assert.equal(await page.locator('.monthly-count.before-open').textContent(), '오픈 전');
    assert.equal(await page.locator('.monthly-count.unknown').textContent(), '미확인');
    const boxes = await page.locator('.monthly-count').evaluateAll(nodes => nodes.map(e => ({ nowrap: getComputedStyle(e).whiteSpace, width: e.clientWidth, scrollWidth: e.scrollWidth, height: e.clientHeight })));
    assert.ok(boxes.every(b => b.nowrap === 'nowrap' && b.scrollWidth <= b.width + 1 && b.height < 30));
    assert.notEqual(await page.locator('.monthly-count.booked').evaluate(e => getComputedStyle(e).backgroundColor), await page.locator('.monthly-count.available').evaluate(e => getComputedStyle(e).backgroundColor));
    gate = new Promise(resolve => { release = resolve; }); await page.locator('#monthlyNextButton').click();
    await page.locator('[data-date="2026-12-01"] .monthly-count.loading').waitFor();
    assert.equal(await page.locator('#monthlyContent .monthly-room-row').count(), 0); release();
    await page.waitForFunction(() => !document.querySelector('#monthlyQueryButton').disabled);
    await page.route(/\/api\/monthly-availability\?/, route => route.fulfill({ status: 429, json: { error: '모의 요청 제한' } }));
    await page.locator('#monthlyQueryButton').click();
    await page.waitForFunction(() => !document.querySelector('#monthlyQueryButton').disabled);
    assert.equal(await page.locator('.monthly-count.loading').count(), 0);
    assert.equal(await page.locator('#monthlyContent .monthly-room-row').count(), 0);
    assert.equal(dayCalls, 0); assert.deepEqual(state.errors, []); await page.close();
  }
});
