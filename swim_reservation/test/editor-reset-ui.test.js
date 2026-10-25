import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { mockBookApp } from './fixtures/ui-book-app.js';
const executablePath = [process.env.CHROMIUM_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
async function setup(t, width = 390) {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const state = await mockBookApp(page);
  return { page, state };
}
const tab = (page, name) => page.evaluate(name => switchWorkspaceTab(name), name);
async function fill(page, name) {
  await page.locator('#planName').fill(name);
  await page.locator('#reserverName').fill('모의예약자');
  await page.locator('#phone').fill('01000000000');
  await page.locator('#campRequest').fill('모의 요청');
}

test('PC·폰의 모드별 예약 초안은 설정·조회 탭 전환과 같은 탭 새로고침 뒤에도 유지된다', { skip: !executablePath }, async t => {
  for (const width of [390, 1280]) {
    const { page, state } = await setup(t, width);
    await fill(page, '단독 초안');
    await tab(page, 'settings'); await tab(page, 'priority');
    assert.equal(await page.locator('#planName').inputValue(), '단독 초안');
    assert.equal(await page.locator('#phone').inputValue(), '01000000000');
    await tab(page, 'multiple'); await fill(page, '다중 초안');
    await tab(page, 'priority');
    assert.equal(await page.locator('#planName').inputValue(), '단독 초안');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('planName').value === '단독 초안');
    assert.equal(await page.locator('#campRequest').inputValue(), '모의 요청');
    await tab(page, 'multiple');
    assert.equal(await page.locator('#planName').inputValue(), '다중 초안');
    assert.deepEqual(state.errors, []);
  }
});

test('일정 등록만으로 입력을 지우지 않고 연결된 예약 성공 때만 초기화한다', { skip: !executablePath }, async t => {
  const { page, state } = await setup(t);
  await fill(page, '완료할 초안');
  await page.evaluate(() => registerPlan('scheduled', false));
  assert.equal(await page.locator('#planName').inputValue(), '완료할 초안');
  const duplicate = await page.evaluate(async () => { try { await registerPlan('scheduled', false); return ''; } catch (error) { return error.message; } });
  assert.match(duplicate, /이미 등록한 일정/);
  assert.equal(state.plans.length, 1);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('planName').value === '완료할 초안');
  state.plans[0].status = { state: 'failed' };
  await page.evaluate(() => refreshPlans());
  assert.equal(await page.locator('#planName').inputValue(), '완료할 초안');
  state.plans[0].status = { state: 'success' };
  await page.evaluate(() => refreshPlans());
  assert.equal(await page.locator('#planName').inputValue(), '');
  assert.equal(await page.locator('#phone').inputValue(), '');
  assert.equal(await page.locator('#campRequest').inputValue(), '');
  assert.equal(state.book.length, 2);
  assert.equal(state.plans.length, 1);
});

test('이전 예약의 성공 응답은 새로 편집한 초안을 지우지 않는다', { skip: !executablePath }, async t => {
  const { page, state } = await setup(t);
  await fill(page, '이전 초안'); await page.evaluate(() => registerPlan('scheduled', false));
  await page.locator('#planName').fill('새로운 초안');
  state.plans[0].status = { state: 'success' };
  await page.evaluate(() => refreshPlans());
  assert.equal(await page.locator('#planName').inputValue(), '새로운 초안');
});

test('플로팅 초기화의 확인·취소는 현재 모드 초안만 지우고 모바일 제출 간격은 한 줄이다', { skip: !executablePath }, async t => {
  const { page, state } = await setup(t);
  await fill(page, '단독 입력');
  await tab(page, 'multiple'); await fill(page, '다중 입력');
  await page.evaluate(() => { window.confirm = () => { throw new Error('Native confirm blocked'); }; });
  await page.locator('#editorResetButton').click();
  await page.locator('#editorResetCancel').click();
  assert.equal(await page.locator('#planName').inputValue(), '다중 입력');
  await page.locator('#editorResetButton').click();
  await page.locator('#editorResetConfirm').click();
  assert.equal(await page.locator('#planName').inputValue(), '');
  assert.equal(await page.locator('#editorResetButton').isVisible(),false);
  await tab(page, 'priority');
  assert.equal(await page.locator('#planName').inputValue(), '단독 입력');
  assert.equal(await page.locator('#phone').inputValue(), '01000000000');
  assert.equal(state.book.length, 2);
  assert.ok(state.writes.every(path => path === '/api/inspect'));
  await tab(page, 'settings');
  const input = await page.locator('#finalSubmitInterval').boundingBox();
  const button = await page.locator('#saveFinalSubmitInterval').boundingBox();
  assert.ok(Math.abs(input.y + input.height / 2 - button.y - button.height / 2) < 4);
  assert.ok(button.x + button.width <= 390);
  assert.deepEqual(state.errors, []);
});
