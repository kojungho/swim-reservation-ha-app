import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { validateCampSites } from '../src/camp-site-identity.js';
import { CAMP_ROOT, catalog, mergeListing, initCatalog, persistCatalog } from '../src/camp-site.js';

const expected={root:CAMP_ROOT,checkin:'2026-12-22',checkout:'2026-12-23'};
const known=[{name:'해_하늘존',displayName:'하늘존해',siteId:1}];
const card=(id=1,displayName='하늘존 해')=>({href:`site.php?ci=${expected.checkin}&co=${expected.checkout}&site=${id}`,displayName});
const native=await readFile(new URL('../../android_app/app/src/main/assets/camp-step.js',import.meta.url),'utf8');
const nativeValidate=new Function(native+';return validateCampSites;')();
test('앱·애드온 사이트 대조 함수는 동일하며 공백만 정규화한다',()=>{
 assert.equal(nativeValidate.toString(),validateCampSites.toString());
 const r=validateCampSites({recognized:true,cards:[card(),card(15,'산맥존새사이트')]},expected,known);
 assert.equal(r.ok,true);assert.deepEqual(r.added,['새사이트_산맥존']);assert.equal(r.cards[0].displayName,'하늘존해');
});
test('번호 재사용·교환은 최신 사이트명으로 해석하고 잘못된 URL·중복은 거절한다',()=>{
 for(const cards of [[card(1,'하늘존달'),card(2,'하늘존해')],[card(16,'하늘존해')]]){const r=validateCampSites({recognized:true,cards},expected,known);assert.equal(r.ok,true);assert.deepEqual(r.changed,['해_하늘존']);assert.deepEqual(nativeValidate({recognized:true,cards},expected,known),r);}
 const wrongs=[
  [card(),card()], [card(),card(16,'하늘존해')],
  [{...card(),href:card().href+'&site=2'}], [{...card(),href:card().href+'&ci=2027-01-01'}],
  [{...card(),href:'https://example.com/camp/'+card().href}],
  [{...card(),href:'https://user@www.swimozicamp.com/camp/'+card().href}],
  [{...card(),href:card().href.replace('site.php','book.php')}],
  [{...card(),href:card().href.replace('2026-12-23','2026-12-24')}],
  [card(10001,'새곳')], [card('1e0')], [card(15,'가'.repeat(81))], [card(15,'')]
 ];
 for(const cards of wrongs){const parsed={recognized:true,cards};assert.equal(validateCampSites(parsed,expected,known).ok,false);assert.deepEqual(nativeValidate(parsed,expected,known),validateCampSites(parsed,expected,known));}
});
test('목록 마지막 카드가 잘못되어도 새 사이트를 일부만 반영하지 않는다',()=>{
 const before=JSON.stringify([...catalog]);
 assert.throws(()=>mergeListing({recognized:true,cards:[card(15,'산맥존신규테스트'),card()] .map((c,i)=>i?{...c,href:c.href+'&site=2'}:c)}, {startDate:expected.checkin,nights:1}),e=>e.code==='CATALOG_MISMATCH');
 assert.equal(JSON.stringify([...catalog]),before);
});
test('번호가 교환된 목록은 저장·재시작 후에도 이름 기준으로 복구한다',async t=>{
 const before=new Map(catalog),dir=await mkdtemp(path.join(tmpdir(),'swim-catalog-')),file=path.join(dir,'catalog.json');
 t.after(async()=>{catalog.clear();for(const [name,room]of before)catalog.set(name,room);await rm(dir,{recursive:true,force:true});});
 await initCatalog(file);
 mergeListing({recognized:true,cards:[card(11,'하늘존해'),card(1,'산맥존숨')]},{startDate:expected.checkin,nights:1});await persistCatalog();
 catalog.clear();for(const [name,room]of before)catalog.set(name,room);
 await initCatalog(file);assert.equal(catalog.get('해_하늘존').siteId,11);assert.equal(catalog.get('숨_산맥존').siteId,1);
 assert.equal(new Set([...catalog.values()].map(r=>r.siteId)).size,catalog.size);
});
test('앱 온라인·오프라인 목록 모두 신규 사이트를 반환하고 충돌은 거절한다',async t=>{
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});t.after(()=>b.close());
 const page=await b.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div class="room-list"><a class="room-card" href="'+card(15).href+'"><span class="room-name">산맥존새사이트</span></a></div>'}));
 const url=CAMP_ROOT+`?ci=${expected.checkin}&co=${expected.checkout}`;await page.goto(url);
 const p={date:expected.checkin,checkout:expected.checkout,catalog:known};
 for(const op of ['listing','preflight-listing']){const r=await page.evaluate(new Function('arg',native+';return campStep(arg.op,arg.p,arg.offline);'),{op,p,offline:op==='listing'?undefined:url});assert.equal(r.ok,true);assert.deepEqual(r.addedSites,['새사이트_산맥존']);assert.equal(r.catalog[0].siteId,15);}
 await page.locator('.room-card').evaluate(a=>a.href+='&site=16');
 assert.equal((await page.evaluate(new Function('p',native+';return campStep("listing",p);'),p)).code,'CATALOG_MISMATCH');
});
