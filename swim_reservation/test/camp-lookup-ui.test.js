import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { mockBookApp } from './fixtures/ui-book-app.js';
const executablePath = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
test('PC·폰의 새 예약 조회는 예약번호·입금 대기·기한·전화 취소 안내를 표시하고 취소 버튼을 만들지 않는다', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const state = await mockBookApp(page);
    await page.locator('#workspaceMenuButton').click();
    await page.locator('[data-workspace-tab="people"]').click();
    await page.waitForFunction(() => !savedLookupPending);
    await page.evaluate(() => renderReservations([{ id: 'TEST123-ABC', room: '숨_산맥존', stayDate: '2026-12-22', nights: '1박', total: '60,000원', status: '입금 대기', depositDeadline: '10월 26일 (월) 15:58 까지', cancelable: false, cancelPolicy: 'contact', profileIndex: 0 }], { profiles: [{ reserverName: '모의예약자', phone: '01000000000' }] }));
    const row = page.locator('#reservationList .reservation-row');
    assert.ok((await row.boundingBox()).height <= 85);
    await row.locator('summary').click();
    assert.match(await row.innerText(), /예약번호 TEST123-ABC/);
    assert.match(await row.innerText(), /입금 대기/);
    assert.match(await row.innerText(), /입금 기한.*15:58/);
    assert.match(await row.innerText(), /취소는 캠핑장/);
    assert.equal(await row.locator('.reservation-cancel-button').count(), 0);
    assert.ok(!/예약 확정|결제 금액/.test(await row.innerText()));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(state.errors, []);
    await page.close();
  }
});
