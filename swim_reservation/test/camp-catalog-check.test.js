import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright-core';
import {ReservationEngine} from '../src/camp-engine.js';import {catalog,catalogSnapshot} from '../src/camp-site.js';import {checkDailyCatalog} from '../src/camp-catalog-check.js';
const startDate='2030-10-05',dates=[startDate,'2030-10-06'];
async function fixture(t,bad=false){
 const before=new Map(catalog);t.after(()=>{catalog.clear();for(const [n,r]of before)catalog.set(n,r);});catalog.clear();catalog.set('해_하늘존',{name:'해_하늘존',displayName:'하늘존해',siteId:1});catalog.set('달_하늘존',{name:'달_하늘존',displayName:'하늘존달',siteId:2});
 const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});t.after(()=>b.close());const logs=[],requests=[];
 const engine=new ReservationEngine({browserProvider:()=>b,store:{updateStatus:async()=>{},recordLog:async(...r)=>logs.push(r)}});await engine.ensurePage();let notified;engine.onCatalogUpdated=async rows=>{notified=rows;};
 const names={1:'하늘존달',2:'하늘존숨',3:'하늘존해',4:'산맥존새사이트'};
 await engine.context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());requests.push(req.method());assert.equal(req.method(),'GET');if(u.pathname==='/camp/')return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="room-list">${(u.searchParams.get('ci')===startDate?[1,3]:[4]).map(id=>`<a class="room-card" href="/camp/site.php?${u.searchParams}&site=${id}"><span class="room-name">${names[id]}</span></a>`).join('')}</div>`});const id=Number(u.searchParams.get('site'));return route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1 class="detail-heading">${names[id]}</h1><form class="js-quote" data-site="${id}" data-ci="${u.searchParams.get('ci')}" data-co="${bad&&id===4?'2030-11-01':u.searchParams.get('co')}"></form>`});});
 // Static metadata parsing never executes scripts or loads gallery images.
 await engine.context.route('**/camp/site.php?**',route=>{const u=new URL(route.request().url()),id=Number(u.searchParams.get('site'));requests.push(route.request().method());if(!bad&&id===4)for(const [name,room]of catalog)catalog.set(name,{displayName:room.displayName,siteId:room.siteId,name:room.name});return route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1 class="detail-heading">${names[id]}</h1><form class="js-quote" data-site="${id}" data-ci="${u.searchParams.get('ci')}" data-co="${bad&&id===4?'2030-11-01':u.searchParams.get('co')}"></form><img src="https://example.invalid/image"><script>fetch('/camp/book.php',{method:'POST'})</script>`});});
 return {engine,logs,requests,notified:()=>notified};
}
test('매일 여러 날짜에서 신규 사이트를 찾고 마감 사이트까지 전부 확인해 미리 저장한다',async t=>{
 const f=await fixture(t);const r=await checkDailyCatalog(f.engine,{adults:2},dates,Date.now());assert.equal(r.checkedCount,4);assert.equal(r.datesChecked,2);assert.equal(catalog.get('해_하늘존').siteId,3);assert.equal(catalog.get('달_하늘존').siteId,1);assert.equal(catalog.get('숨_하늘존').siteId,2);assert.equal(catalog.get('새사이트_산맥존').siteId,4);assert.equal(f.notified().length,4);assert.equal(catalogSnapshot().entries.length,4);assert.equal(f.requests.length,7);assert.ok(f.requests.every(m=>m==='GET'));
});
test('전체 확인이 끝나기 전에 오류가 나면 마지막 확인 목록·현재 매핑을 교체하지 않는다',async t=>{
 const f=await fixture(t,true),before=JSON.stringify([...catalog]),published=JSON.stringify(catalogSnapshot());await assert.rejects(checkDailyCatalog(f.engine,{adults:2},dates,Date.now()),e=>e.code==='CATALOG_MISMATCH');assert.equal(JSON.stringify([...catalog]),before);assert.equal(JSON.stringify(catalogSnapshot()),published);assert.equal(f.notified(),undefined);
});
test('대기 일정의 원하는 이름을 연결하지 못하면 미리 점검 오류로 알릴 수 있다',async t=>{
 const f=await fixture(t);await assert.rejects(checkDailyCatalog(f.engine,{preflightRequestedSites:['없는사이트_하늘존']},dates,Date.now(),undefined,{delayMs:0}),e=>e.code==='CATALOG_REQUESTED_SITE_MISSING');assert.equal(catalogSnapshot().entries.length,4);
});
