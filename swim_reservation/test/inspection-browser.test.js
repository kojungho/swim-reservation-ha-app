import test from 'node:test';
import assert from 'node:assert/strict';
import { InspectionBrowser, attachInspectionBrowser } from '../src/inspection-browser.js';
import { InspectionService } from '../src/inspection-service.js';
import { chromium } from 'playwright-core';
import { ReservationEngine } from '../src/camp-engine.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
test('조회 브라우저만 재사용하고 유휴 후 종료·연결 끊김·실패에서 복구한다', async () => {
  let launches = 0;
  const pool = new InspectionBrowser(async () => {
    launches++;
    return { live: true, isConnected() { return this.live; }, async close() { this.live = false; } };
  }, 20);
  const a = await pool.acquire(); pool.release();
  const b = await pool.acquire(); assert.equal(a, b); pool.release();
  assert.equal(launches, 1);
  await sleep(40); assert.equal(a.live, false);
  const c = await pool.acquire(); assert.notEqual(c, a);
  c.live = false; pool.release();
  assert.notEqual(await pool.acquire(), c); pool.release(); await pool.close();
  let failures = 0;
  const retry = new InspectionBrowser(async () => { if (!failures++) throw Error('launch failed'); return b; });
  await assert.rejects(retry.acquire()); assert.equal(retry.users, 0);
  assert.equal(await retry.acquire(), b); retry.release(); await retry.close();
});

test('재사용 중에도 쿠키·페이지 격리, 해당 조회 취소, 불필요한 미디어 차단을 유지한다', async t => {
  let launches = 0;
  const pool = new InspectionBrowser(async () => {
    launches++;
    return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  });
  t.after(() => pool.close());
  const readers = [];
  const service = new InspectionService(() => {
    const reader = attachInspectionBrowser(new ReservationEngine({ store: { recordLog: async () => {} } }), pool);
    reader.inspect = async ({ slow }) => {
      await reader.context.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>목록</h1>' }));
      await reader.page.goto('https://fixture.test/');
      assert.equal(await reader.page.evaluate(() => document.cookie), '');
      await reader.page.evaluate(() => { document.cookie = 'test=private'; });
      // A separately routed resource must be aborted before it reaches network.
      const blocked = reader.page.waitForEvent('requestfailed', { predicate: r => r.url().endsWith('photo.jpg') });
      await reader.page.evaluate(() => { const image = new Image(); image.src = 'https://other.test/photo.jpg'; document.body.append(image); });
      await blocked;
      if (slow) await reader.page.waitForTimeout(10000);
      return ['verified'];
    };
    readers.push(reader); return reader;
  });
  assert.deepEqual(await service.inspect({}), ['verified']);
  const controller = new AbortController();
  const canceled = assert.rejects(service.inspect({ slow: true }, controller.signal), { code: 'INSPECTION_CANCELED' });
  while (readers.length < 2 || !readers[1].page) await sleep(10);
  controller.abort(); await canceled;
  assert.deepEqual(await service.inspect({}), ['verified']);
  assert.equal(launches, 1);
  assert.equal(pool.users, 0);
  assert.ok(readers.every(r => r.page === null && r.context === null));
});
