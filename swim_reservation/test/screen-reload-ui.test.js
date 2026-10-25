import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { mockBookApp } from './fixtures/ui-book-app.js';
const executablePath = [process.env.CHROMIUM_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);

test('PC·폰에서 브라우저 확인창 없이 취소는 입력을 보존하고 승인만 최신 주소로 이동한다', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const state = await mockBookApp(page);
    await page.evaluate(() => {
      history.replaceState(null, '', '?existing=kept#settings');
      window.confirm = () => { throw new Error('Native confirmation must not be used'); };
      document.getElementById('screenUpdateNotice').hidden = false;
    });
    await page.locator('#reserverName').fill('저장 전 입력');
    await page.locator('#screenReloadButton').click();
    assert.equal(await page.locator('#screenReloadConfirm').isVisible(), true);
    assert.equal(await page.locator('#screenReloadButton').getAttribute('aria-expanded'), 'true');
    await page.locator('#screenReloadCancel').click();
    assert.equal(await page.locator('#screenReloadConfirm').isVisible(), false);
    assert.equal(await page.locator('#reserverName').inputValue(), '저장 전 입력');
    assert.ok(!new URL(page.url()).searchParams.has('_screen'));
    await page.locator('#screenReloadButton').click();
    const target = new URL(await page.locator('#screenReloadProceed').getAttribute('href'));
    assert.equal(target.origin, 'https://app.test');
    assert.equal(target.pathname, '/');
    assert.equal(target.searchParams.get('existing'), 'kept');
    assert.equal(target.hash, '#settings');
    assert.match(target.searchParams.get('_screen'), /^\d+$/);
    await Promise.all([page.waitForURL(url => url.searchParams.has('_screen')), page.locator('#screenReloadProceed').click()]);
    assert.ok(state.writes.every(path => path === '/api/inspect')); // Normal read-only availability refresh, never booking/settings writes.
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.dialogs, []);
    await page.close();
  }
});

test('HA와 같은 확인창 차단 iframe에서도 현재 프레임만 새로 열고 상위 앱 주소를 유지한다', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await mockBookApp(page);
  const parentUrl = page.url();
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.id = 'embedded'; frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.src = '/?embedded=kept#logs'; frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9999;background:white';
    document.body.append(frame);
  });
  const frame = page.frames().find(item => item !== page.mainFrame());
  await frame.waitForFunction(() => typeof bindEvents === 'function' && document.getElementById('bookingProfileSelect1')?.options.length > 1);
  assert.equal(await frame.evaluate(() => window.confirm('blocked test')), false);
  await frame.evaluate(() => { document.getElementById('screenUpdateNotice').hidden = false; });
  await frame.locator('#screenReloadButton').click();
  assert.equal(await frame.locator('#screenReloadConfirm').isVisible(), true);
  await Promise.all([frame.waitForURL(url => url.searchParams.has('_screen')), frame.locator('#screenReloadProceed').click()]);
  assert.equal(page.url(), parentUrl);
  assert.equal(new URL(frame.url()).searchParams.get('embedded'), 'kept');
  assert.equal(new URL(frame.url()).hash, '#logs');
});
