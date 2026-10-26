import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright-core';import {mockBookApp} from './fixtures/ui-book-app.js';import {normalizeUiSettings} from '../src/ui-settings.js';import {readFile} from 'node:fs/promises';
const executablePath=process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('앱·애드온 메뉴는 독립 저장하며 잘못된 설정은 거부한다',()=>{const settings=normalizeUiSettings({addonMenus:{priority:false},appMenus:{watch:false}});assert.equal(settings.addonMenus.priority,false);assert.equal(settings.addonMenus.watch,true);assert.equal(settings.appMenus.priority,true);assert.equal(settings.appMenus.watch,false);assert.throws(()=>normalizeUiSettings({appMenus:{watch:1}}));});
test('공통 입력 흐름·선택창 소스는 동일하다',async()=>{for(const file of ['booking-flow.js','booking-flow.css','site-choice.js'])assert.equal(await readFile(new URL('../public/'+file,import.meta.url),'utf8'),await readFile(new URL('../../android_app/app/src/main/assets/ui/'+file,import.meta.url),'utf8'));});
test('애드온 단계·사이트 팝업·단일 예약자 조회·중지·비회원 조회·메뉴 구분',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());for(const width of [320,390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});t.after(()=>page.close());const state=await mockBookApp(page);await page.waitForSelector('.booking-step-title');
 await page.locator('#reserverName').fill('');await page.locator('#phone').fill('');await page.waitForFunction(()=>document.querySelectorAll('.booking-step-title')[2].disabled);
 assert.equal(await page.locator('#roomList').isVisible(),false);await page.locator('#reserverName').fill('모의예약자');await page.locator('#phone').fill('01000000000');await page.waitForFunction(()=>!document.querySelectorAll('.booking-step-title')[2].disabled);
 assert.equal(await page.locator('#inspectButton').isVisible(),false);assert.equal(await page.locator('#watchSelectAll').isVisible(),false);
 // Completion of the required person fields automatically opens the picker.
 const dialog=page.locator('.site-choice-dialog');await dialog.waitFor();assert.ok(await dialog.locator('.site-choice-option').count()>0);assert.equal(await dialog.locator('.site-choice-option strong').filter({hasText:'존'}).count(),0);
 await dialog.getByRole('button',{name:'전체 선택',exact:true}).click();await dialog.getByRole('button',{name:'완료',exact:true}).click();assert.ok(await page.locator('#roomList .site-choice-row').count()>0);
 await page.evaluate(()=>{availabilityContext=elements.startDate.value+'/'+Number(elements.nights.value);for(const room of rooms)availabilityByRoom.set(room.name,'unavailable');renderRooms();});assert.equal(await page.locator('#roomList .site-choice-tools button').isDisabled(),true);
 await page.evaluate(()=>switchWorkspaceTab('people'));await page.waitForFunction(()=>document.querySelector('#siteProfileSelect').options.length===2);
 let queried;await page.route('**/api/reservations',route=>{queried=route.request().postDataJSON();return route.fulfill({json:{reservations:[],lookupErrors:[]}});});
 await page.locator('#siteProfileSelect').selectOption('2');await page.locator('#reservationLookupButton').click();await page.waitForFunction(()=>document.querySelector('#reservationList').hidden===false);assert.equal(queried.profiles.length,1);assert.equal(queried.profiles[0].reserverName,'저장예약자이');
 assert.equal(await page.locator('#lookupStopButton').evaluate(e=>e.classList.contains('danger')),true);assert.equal(await page.locator('.one-off-lookup summary').textContent(),'비회원 조회');
 await page.evaluate(()=>switchWorkspaceTab('settings'));assert.equal(await page.locator('#addonMenus-priority').count(),1);assert.equal(await page.locator('#appMenus-priority').count(),1);
 await page.locator('#addonMenus-priority').uncheck();assert.equal(await page.locator('[data-workspace-tab=priority]').evaluate(e=>e.hidden),true);assert.equal(await page.locator('#appMenus-priority').isChecked(),true);assert.deepEqual(state.errors,[]);assert.equal(state.planCalls.length,0);
 if(width===390)await page.screenshot({path:'/tmp/swim-flow-addon-21517.png',fullPage:true});
 }});
