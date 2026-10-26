import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright-core';import {catalog} from '../src/camp-site.js';import {campReceipt} from './fixtures/camp-receipt.js';
const executablePath=process.env.CHROMIUM_PATH||'/usr/bin/chromium';
test('자동취소는 앱 조회에서 취소로 표시하고 예약 신청 성공으로 보지 않는다',async t=>{
 const b=await chromium.launch({executablePath,headless:true});t.after(()=>b.close());const page=await b.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:campReceipt({state:'자동취소'})}));await page.goto('https://www.swimozicamp.com/camp/lookup.php');
 const helpers=await readFile(new URL('../../android_app/app/src/main/assets/camp-engine.js',import.meta.url),'utf8'),step=await readFile(new URL('../../android_app/app/src/main/assets/camp-step.js',import.meta.url),'utf8');
 const rooms=[...catalog.values()],r=await page.evaluate(new Function('p',helpers+';return readCampReservations(p);'),{expectedName:'테스트예약자',rooms});assert.equal(r.kind,'detail');assert.equal(r.rows[0].status,'자동 취소');assert.equal(r.rows[0].paymentStatus,'closed');
 const actual=rooms.find(x=>x.name==='숨_산맥존');const result=await page.evaluate(new Function('p',helpers+step+';return campStep("receipt",p);'),{name:'테스트예약자',date:'2026-12-22',checkout:'2026-12-23',nights:1,adults:2,site:actual.siteId,catalog:rooms});assert.equal(result.ok,false);assert.equal(result.checks.pending,false);
});
