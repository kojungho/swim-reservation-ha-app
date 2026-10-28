import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { mockBookApp } from './fixtures/ui-book-app.js';
import {readFile} from 'node:fs/promises';
import {APP_VERSION,renderClientScript} from '../src/static-files.js';
const executablePath = [process.env.CHROMIUM_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);

test('최신 화면은 안내하지 않고 캠핑 노트 iframe의 구버전은 새로 열면 실제 최신 코드로 교체된다', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 const source=renderClientScript(await readFile(new URL('../public/app.js',import.meta.url),'utf8'));
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),state=await mockBookApp(page);
  await page.route('**/api/status',route=>route.fulfill({json:{state:'idle',appVersion:APP_VERSION}}));
  await page.evaluate(async()=>{nextStatusCheck=0;await refreshStatus();});
  assert.equal(await page.evaluate(()=>CLIENT_VERSION),APP_VERSION);assert.equal(await page.locator('#screenUpdateNotice').isVisible(),false);
  let old=true;await page.route('https://app.test/app.js',route=>route.fulfill({contentType:'text/javascript',headers:{'Cache-Control':'no-store'},body:old?source.replace('const CLIENT_VERSION = '+JSON.stringify(APP_VERSION)+';','const CLIENT_VERSION = "2.15.30";'):source}));
  const parentUrl=page.url();await page.evaluate(()=>{const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.src='/?camping-note=kept#logs';document.body.append(frame);});
  const frame=page.frames().find(item=>item!==page.mainFrame());await frame.waitForFunction(()=>typeof refreshStatus==='function'&&document.getElementById('screenReloadButton'));
  await frame.evaluate(async()=>{nextStatusCheck=0;await refreshStatus();});assert.equal(await frame.evaluate(()=>CLIENT_VERSION),'2.15.30');assert.equal(await frame.locator('#screenUpdateNotice').isVisible(),true);
  await frame.locator('#screenReloadButton').click();old=false;
  await Promise.all([frame.waitForURL(url=>url.searchParams.has('_screen')),frame.locator('#screenReloadProceed').click()]);
  await frame.waitForFunction(version=>typeof CLIENT_VERSION!=='undefined'&&CLIENT_VERSION===version,APP_VERSION);await frame.evaluate(async()=>{nextStatusCheck=0;await refreshStatus();});
  assert.equal(await frame.locator('#screenUpdateNotice').isVisible(),false);assert.equal(page.url(),parentUrl);assert.equal(new URL(frame.url()).searchParams.get('camping-note'),'kept');assert.equal(new URL(frame.url()).hash,'#logs');
  assert.ok(state.writes.every(path=>path==='/api/inspect'));assert.deepEqual(state.errors,[]);await page.close();
 }
});

test('PC·폰에서 브라우저 확인창 없이 취소는 입력을 보존하고 승인만 최신 주소로 이동한다', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const state = await mockBookApp(page);
    await page.route('https://app.test/api/status', route => route.fulfill({ json: { state: 'idle', appVersion: 'new-server-test' } }));
    await page.evaluate(() => {
      history.replaceState(null, '', '?existing=kept#settings');
      window.confirm = () => { throw new Error('Native confirmation must not be used'); };
    });
    await page.evaluate(() => refreshStatus());
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
  await page.route('https://app.test/api/status', route => route.fulfill({ json: { state: 'idle', appVersion: 'new-server-test' } }));
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
  await frame.evaluate(() => refreshStatus());
  await frame.locator('#screenReloadButton').click();
  assert.equal(await frame.locator('#screenReloadConfirm').isVisible(), true);
  await Promise.all([frame.waitForURL(url => url.searchParams.has('_screen')), frame.locator('#screenReloadProceed').click()]);
  assert.equal(page.url(), parentUrl);
  assert.equal(new URL(frame.url()).searchParams.get('embedded'), 'kept');
  assert.equal(new URL(frame.url()).hash, '#logs');
});
