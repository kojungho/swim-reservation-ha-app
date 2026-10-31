import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fillCampForm } from '../src/camp-form.js';
import {readFile} from 'node:fs/promises';
import {ReservationEngine as CampEngine} from '../src/camp-engine.js';
const executablePath = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
const html = `<form><input type="hidden" name="_csrf" value="FAKE-UNTOUCHED"><input name="name" maxlength="30" required><input type="tel" name="phone" required><input name="depositor"><textarea name="request"></textarea><select name="arrive_time"><option value=""></option><option value="14:00 ~ 15:00">14시</option></select><input type="radio" name="pay_method" value="bank"><input type="radio" name="pay_method" value="card" checked><input type="checkbox" class="js-agree" data-required="1" name="agree_refund" required><input type="checkbox" name="marketing"><button type="submit">신청</button></form>`;
const values = { fields: { name: '모의예약자', phone: '01000000000', depositor: '모의입금자', request: '모의 요청', arrive_time: '14:00 ~ 15:00' } };
const fixedHtml=html.replace('<input type="radio" name="pay_method" value="bank"><input type="radio" name="pay_method" value="card" checked>','<input type="hidden" name="pay_method" value="bank">');
test('바뀐 이름·전화번호 라벨과 하이픈 형식·필수 환불/개인정보 약관을 찾아 입력하고 선택 약관은 남긴다',{skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const source=fixedHtml.replace('<input name="name" maxlength="30" required>','<label for="guest_v2">예약자명 (필수)</label><input name="guest_v2" id="guest_v2" required>').replace('<input type="tel" name="phone" required>','<label for="contact_v2">휴대폰 번호 (필수)</label><input type="tel" name="contact_v2" id="contact_v2" placeholder="010-0000-0000" pattern="[0-9]{3}-[0-9]{3,4}-[0-9]{4}" required>').replace('<input type="checkbox" class="js-agree" data-required="1" name="agree_refund" required>','<label><input type="checkbox" name="refund_v2" required>[필수] 취소·환불 규정 동의</label><label><input type="checkbox" name="privacy_v2" required>[필수] 개인정보 수집·이용 동의</label><label><input type="checkbox" name="ads_v2" data-required="0">[선택] 마케팅 동의</label>');
 await page.setContent(source);assert.equal((await page.locator('form').evaluate(fillCampForm,values)).ok,true);assert.equal(await page.locator('#guest_v2').inputValue(),values.fields.name);assert.equal(await page.locator('#contact_v2').inputValue(),'010-0000-0000');assert.equal(await page.locator('[name=refund_v2]').isChecked(),true);assert.equal(await page.locator('[name=privacy_v2]').isChecked(),true);assert.equal(await page.locator('[name=ads_v2]').isChecked(),false);
 assert.equal((await page.locator('form').evaluate(fillCampForm,{verifyOnly:true,...values})).ok,true);
 await page.locator('#contact_v2').fill('010-9999-9999');assert.equal((await page.locator('form').evaluate(fillCampForm,{verifyOnly:true,...values})).ok,false);assert.equal(await page.locator('#contact_v2').inputValue(),'010-9999-9999');
});
test('10/11자리 번호를 세 칸 형식에 맞추고 다른 번호·모호한 전화칸·알 수 없는 필수 약관은 제출 전에 거부한다',{skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const input='<input type="tel" name="phone" required>',parts='<label>휴대폰 번호<select name="phone1"><option>010</option><option>011</option></select><input name="phone2" maxlength="4" required><input name="phone3" maxlength="4" required></label>';
 for(const number of ['01012345678','0111234567']){await page.setContent(fixedHtml.replace(input,parts));const fields={...values.fields,phone:number};assert.equal((await page.locator('form').evaluate(fillCampForm,{fields})).ok,true);assert.equal(await page.locator('[name=phone1]').inputValue(),number.slice(0,3));assert.equal(await page.locator('[name=phone2]').inputValue(),number.slice(3,-4));assert.equal(await page.locator('[name=phone3]').inputValue(),number.slice(-4));assert.equal((await page.locator('form').evaluate(fillCampForm,{fields,verifyOnly:true})).ok,true);}
 for(const source of [fixedHtml.replace(input,'<label>전화번호<input name="unknown_a"></label><label>전화번호<input name="unknown_b"></label>'),fixedHtml.replace('name="marketing"','name="marketing" checked'),fixedHtml.replace('name="marketing"','name="unknown_required" required')]){
  await page.setContent(source);assert.equal((await page.locator('form').evaluate(fillCampForm,values)).ok,false);assert.equal(await page.locator('[name=name]').inputValue(),'');
 }
});
test('카드가 기본이거나 결제 선택이 드롭다운이어도 무통장만 선택하고 지원되지 않으면 중단한다', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent(fixedHtml.replace('<input type="hidden" name="pay_method" value="bank">','<select name="pay_method"><option value="card" selected>카드</option><option value="bank">무통장입금</option><option value="transfer">계좌이체</option></select>'));
 assert.equal((await page.locator('form').evaluate(fillCampForm,values)).ok,true);assert.equal(await page.locator('[name=pay_method]').inputValue(),'bank');
 await page.locator('[name=pay_method]').evaluate(e=>e.options[1].disabled=true);assert.equal((await page.locator('form').evaluate(fillCampForm,{paymentOnly:true})).ok,false);
 await page.setContent(fixedHtml.replace('<input type="hidden" name="pay_method" value="bank">','<select name="pay_method"><option value="card">카드</option><option value="transfer">계좌이체</option></select>'));assert.equal((await page.locator('form').evaluate(fillCampForm,values)).ok,false);assert.equal(await page.locator('[name=pay_method]').inputValue(),'card');assert.equal(await page.locator('[name=name]').inputValue(),'');
});

test('현재 공식 고정 무통장 폼은 숨김값·CSRF를 변경하지 않고 입력 및 읽기 검증을 통과한다', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();await page.setContent(fixedHtml);
 await page.evaluate(()=>{window.paymentChanges=0;window.submits=0;document.querySelector('[name=pay_method]').addEventListener('change',()=>window.paymentChanges++);document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submits++;});});
 const result=await page.locator('form').evaluate(fillCampForm,values);assert.equal(result.ok,true);assert.equal(result.steps.find(s=>s.step==='payment-select').checks.fixedBank,true);
 assert.equal((await page.locator('form').evaluate(fillCampForm,{paymentOnly:true})).ok,true);assert.equal(await page.locator('[name=pay_method]').inputValue(),'bank');assert.equal(await page.locator('[name=_csrf]').inputValue(),'FAKE-UNTOUCHED');assert.deepEqual(await page.evaluate(()=>[paymentChanges,submits]),[0,0]);
 await page.locator('[name=pay_method]').evaluate(e=>e.value='card');assert.equal((await page.locator('form').evaluate(fillCampForm,{paymentOnly:true})).ok,false);assert.equal(await page.locator('[name=pay_method]').inputValue(),'card');
});
test('결제 항목 누락·비활성·중복·혼합·비은행 고정값은 입력 전에 거부하고 자동 보정하지 않는다', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 for(const field of ['', '<input type=hidden name=pay_method value=card>','<input type=hidden name=pay_method value=bank disabled>','<fieldset disabled><input type=hidden name=pay_method value=bank></fieldset>','<input type=radio name=pay_method value=bank disabled>','<input type=radio name=pay_method value=card>', '<input type=hidden name=pay_method value=bank><input type=hidden name=pay_method value=bank>','<input type=hidden name=pay_method value=bank><input type=radio name=pay_method value=bank>']){
  await page.setContent(fixedHtml.replace('<input type="hidden" name="pay_method" value="bank">',field));const result=await page.locator('form').evaluate(fillCampForm,values);assert.equal(result.ok,false,field);assert.equal(result.code,'PAYMENT_METHOD_UNRECOGNIZED',field);assert.equal(await page.locator('[name=name]').inputValue(),'');
 }
});
test('서버·Android 폼과 제출 직전 검사는 같은 고정 무통장 처리를 사용하고 변조를 차단한다', {skip:!executablePath},async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 const native=await readFile(new URL('../../android_app/app/src/main/assets/camp-engine.js',import.meta.url),'utf8'),step=await readFile(new URL('../../android_app/app/src/main/assets/camp-step.js',import.meta.url),'utf8');
 assert.equal(native.slice(native.indexOf('function fillCampForm('),native.indexOf('\n\n// Runs inside the browser.')),fillCampForm.toString());
 const hidden={site:'1',checkin:'2027-01-19',checkout:'2027-01-20',adults:'2',children:'0',infants:'0'};
 const source=fixedHtml.replace('<form>','<div class="summary-card"><div class="sum-title">하늘존해</div></div><form class="js-book" action="/camp/book.php" method="post">'+Object.entries(hidden).map(([k,v])=>`<input type=hidden name="${k}" value="${v}">`).join('')).replace('type="submit"','type="submit" class="js-pay"');
 let activeSource=source;await page.route('https://camp.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:activeSource}));await page.goto('https://camp.test/camp/book.php');await page.addScriptTag({content:native+'\n'+step});
 const p={catalog:[{name:'해_하늘존',siteId:1,displayName:'하늘존해'}],site:1,date:hidden.checkin,checkout:hidden.checkout,adults:2,name:values.fields.name,phone:values.fields.phone,payer:values.fields.depositor,request:'',arrival:'',consent:true};
 const prepared=await page.evaluate(p=>campStep('prepare',p),p);assert.equal(prepared.ok,true,JSON.stringify(prepared));
 const target={page,recordTrace(){},currentStep:'pre-submit-verify'},config={startDate:p.date,nights:1,adults:2,profile:{reserverName:p.name,phone:p.phone,depositorName:p.payer}},room=p.catalog[0];await CampEngine.prototype.assertForm.call(target,config,room,{verifyInputs:true});
 await page.evaluate(()=>{window.mockSubmits=0;document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.mockSubmits++;});});assert.equal((await page.evaluate(p=>campStep('submit',p),p)).ok,true);assert.equal(await page.evaluate(()=>mockSubmits),1);
 await page.locator('[name=pay_method]').evaluate(e=>e.value='card');await assert.rejects(CampEngine.prototype.assertForm.call(target,config,room,{verifyInputs:true}),error=>error.code==='FORM_MISMATCH');
 assert.equal((await page.evaluate(p=>campStep('submit',p),p)).code,'PRE_SUBMIT_MISMATCH');assert.equal(await page.locator('[name=pay_method]').inputValue(),'card');assert.equal(await page.evaluate(()=>mockSubmits),1);
 activeSource=source.replace('<input type="tel" name="phone" required>','<label>휴대폰 번호<input type="tel" name="new_contact" pattern="[0-9]{3}-[0-9]{4}-[0-9]{4}" required></label>').replace('<input type="checkbox" class="js-agree" data-required="1" name="agree_refund" required>','<label><input type="checkbox" name="new_refund" required>[필수] 취소 환불 규정 동의</label>');
 await page.reload();await page.addScriptTag({content:native+'\n'+step});const adapted=await page.evaluate(p=>campStep('prepare',p),p);assert.equal(adapted.ok,true,JSON.stringify(adapted));await CampEngine.prototype.assertForm.call(target,config,room,{verifyInputs:true});assert.equal(await page.locator('[name=new_contact]').inputValue(),'010-0000-0000');
 await page.evaluate(()=>document.querySelector('form').addEventListener('submit',event=>event.preventDefault()));assert.equal((await page.evaluate(p=>campStep('submit',p),p)).ok,true);
});
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
  assert.deepEqual(result.steps.map(step => step.step), ['form-controls-check', 'personal-fields-fill', 'payment-select', 'terms-accept', 'input-verify']);
  assert.ok(result.steps.every(step => step.outcome === 'complete' && Number.isFinite(step.elapsedMs)));
  assert.ok(!JSON.stringify(result).includes(values.fields.name));
  assert.ok(!JSON.stringify(result).includes(values.fields.phone));
  assert.equal(await page.locator('[name="name"]').inputValue(), values.fields.name);
  assert.equal(await page.locator('[name="phone"]').inputValue(), values.fields.phone);
  assert.equal(await page.locator('[name="arrive_time"]').inputValue(), values.fields.arrive_time);
  assert.equal(await page.locator('[name="agree_refund"]').isChecked(), true);
  assert.equal(await page.locator('[name="marketing"]').isChecked(), false);
  assert.equal(await page.locator('[value="card"]').isChecked(), false);
  assert.equal(await page.locator('[name="_csrf"]').inputValue(), 'FAKE-UNTOUCHED');
  assert.deepEqual(await page.evaluate(() => [window.inputs, window.changes, window.submits]), [7, 7, 0]);
});
test('일괄 입력의 실패 항목 이름만 기록하고 입력값·약관 원문은 반환하지 않는다', { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(html.replace('type="tel"', 'type="tel" pattern="[0-9]{2}"'));
  const result = await page.locator('form').evaluate(fillCampForm, values);
  assert.equal(result.ok, false);
  assert.equal(result.failedStep, 'form-controls-check');
  assert.deepEqual(result.invalidFields, ['phone']);
  assert.equal(result.steps.at(-1).checks.fieldsRecognized, false);
  assert.ok(!JSON.stringify(result).includes(values.fields.phone));
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
