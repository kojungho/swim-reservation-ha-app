import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fillCampForm } from '../src/camp-form.js';
const executablePath = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
const html = `<form><input type="hidden" name="_csrf" value="FAKE-UNTOUCHED"><input name="name" maxlength="30" required><input type="tel" name="phone" required><input name="depositor"><textarea name="request"></textarea><select name="arrive_time"><option value=""></option><option value="14:00 ~ 15:00">14시</option></select><input type="radio" name="pay_method" value="bank"><input type="radio" name="pay_method" value="card" checked><input type="checkbox" class="js-agree" data-required="1" name="agree_refund" required><input type="checkbox" name="marketing"><button type="submit">신청</button></form>`;
const values = { fields: { name: '모의예약자', phone: '01000000000', depositor: '모의입금자', request: '모의 요청', arrive_time: '14:00 ~ 15:00' } };
test('한 번의 브라우저 평가로 전체 입력·필수 동의를 마치며 CSRF·선택 동의는 보존하고 제출하지 않는다', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await page.setContent(html);
  await page.evaluate(() => {
    window.inputs = 0; window.changes = 0; window.submits = 0;
    document.addEventListener('input', () => window.inputs++); document.addEventListener('change', () => window.changes++);
    document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); window.submits++; });
  });
  const result = await page.locator('form').evaluate(fillCampForm, values);
  assert.equal(result.ok, true);
  assert.equal(await page.locator('[name="name"]').inputValue(), values.fields.name);
  assert.equal(await page.locator('[name="phone"]').inputValue(), values.fields.phone);
  assert.equal(await page.locator('[name="arrive_time"]').inputValue(), values.fields.arrive_time);
  assert.equal(await page.locator('[name="agree_refund"]').isChecked(), true);
  assert.equal(await page.locator('[name="marketing"]').isChecked(), false);
  assert.equal(await page.locator('[value="card"]').isChecked(), false);
  assert.equal(await page.locator('[name="_csrf"]').inputValue(), 'FAKE-UNTOUCHED');
  assert.deepEqual(await page.evaluate(() => [window.inputs, window.changes, window.submits]), [7, 7, 0]);
});
test('필드·약관 변경 또는 잘못된 선택값은 입력 전 검증에서 거부한다', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  for (const source of [html.replace('name="phone"', 'name="different"'), html.replace('data-required="1"', 'data-required="0"'), html.replace('name="name"', 'name="name" disabled')]) {
    await page.setContent(source);
    assert.equal((await page.locator('form').evaluate(fillCampForm, values)).ok, false);
    assert.equal(await page.locator('[name="depositor"]').inputValue(), '');
  }
  await page.setContent(html);
  assert.equal((await page.locator('form').evaluate(fillCampForm, { fields: { ...values.fields, arrive_time: '잘못된 시간' } })).ok, false);
  assert.equal(await page.locator('[name="name"]').inputValue(), '');
});
