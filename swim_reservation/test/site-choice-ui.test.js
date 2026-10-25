import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {mockBookApp} from './fixtures/ui-book-app.js';
const executablePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function setup(t,width=390){
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<600});page.setDefaultTimeout(10000);
 const state=await mockBookApp(page);return {page,state};
}
async function addSite(picker,name){await picker.getByRole('combobox').selectOption(name);await picker.getByRole('button',{name:'사이트 추가',exact:true}).click();}
test('앱과 애드온의 사이트 선택 화면 코드는 동일하다',async()=>{
 assert.equal(await readFile(new URL('../public/site-choice.js',import.meta.url),'utf8'),await readFile(new URL('../../android_app/app/src/main/assets/ui/site-choice.js',import.meta.url),'utf8'));
});
test('날짜별 3곳이지만 같은 사이트 연박 0이면 선택 불가, 달력에는 날짜별 가능 수를 표시한다',async t=>{
 const {page,state}=await setup(t);
 state.availability=state.config.roomPriority.map(room=>({name:room.name,available:false,status:'unavailable'}));
 await page.route('https://app.test/api/monthly-availability?**',route=>{const month=new URL(route.request().url()).searchParams.get('month');return route.fulfill({json:{month,openThrough:'2026-12-31',days:[{date:month+'-17',availableCount:3},{date:month+'-18',availableCount:3},{date:month+'-19',availableCount:2}]}});});
 assert.equal(await page.locator('#checkoutField').isVisible(),true);
 await page.locator('#startDate').fill('2026-12-17');await page.locator('#startDate').click();
 await page.waitForFunction(()=>document.querySelector('[data-date="2026-12-18"] small')?.textContent==='3곳');
 await page.locator('[data-date="2026-12-17"]').click();await page.locator('[data-date="2026-12-19"]').click();
 await page.waitForFunction(()=>availabilityContext==='2026-12-17/2'&&availabilityByRoom.get(rooms[0].name)==='unavailable');
 assert.equal(await page.locator('#roomList select option[value]:not([value=""])').count(),0);
 assert.match(await page.locator('#roomList .site-choice-message').innerText(),/연박은 불가능/);
 assert.equal(await page.locator('#roomList select').isDisabled(),true);
 await page.locator('#startDate').click();await page.locator('#datePickerDialog').screenshot({path:'/tmp/swim-addon-availability-calendar.png'});await page.locator('#datePickerCancel').click();
 assert.equal(state.planCalls.length,0);assert.deepEqual(state.errors,[]);
});
test('선택 기간 가능 사이트만 추가·삭제·정렬하고 다인도 같은 목록을 사용, 예정은 전체 후보',async t=>{
 const {page,state}=await setup(t);
 state.availability=state.config.roomPriority.map((room,i)=>({name:room.name,available:[0,2,4].includes(i),status:[0,2,4].includes(i)?'available':'unavailable'}));
 await page.evaluate(()=>refreshAvailability());const picker=page.locator('#roomList');
 assert.equal(await picker.locator('input[type=checkbox]').count(),0);
 assert.deepEqual(await picker.getByRole('combobox').locator('option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean)),[state.config.roomPriority[0].name,state.config.roomPriority[2].name,state.config.roomPriority[4].name]);
 for(const index of [0,2,4])await addSite(picker,state.config.roomPriority[index].name);
 assert.equal(await picker.locator('.site-choice-row').count(),3);
 await picker.locator('.room-drag-handle').first().focus();await page.keyboard.press('ArrowDown');
 assert.equal(await picker.locator('.site-choice-row').first().getAttribute('data-choice-name'),state.config.roomPriority[2].name);
 await picker.locator('.site-choice-remove').first().click();assert.equal(await picker.locator('.site-choice-row').count(),2);
 await page.evaluate(()=>{switchWorkspaceTab('profiles-parallel');elements.startDate.value='2026-12-17';elements.nights.value='2';updateStayFields();});
 await page.evaluate(()=>refreshAvailability());let people=page.locator('#profilePriorities .site-choice-editor');
 assert.equal(await people.count(),1);
 assert.equal(await people.first().getByRole('combobox').locator('option[value]:not([value=""])').count(),3);
 await page.locator('#addProfileButton').click();assert.equal(await people.count(),2);
 await addSite(people.nth(1),state.config.roomPriority[0].name);assert.equal(await page.evaluate(()=>readConfig().profiles[1].roomPriority.filter(r=>r.enabled).length),1);
 await page.evaluate(()=>{elements.startDate.value='2027-01-17';elements.nights.value='2';updateStayFields();scheduleAvailabilityCheck(0);});
 await page.waitForFunction(()=>availabilityContext==='2027-01-17/2');
 assert.equal(await people.first().getByRole('combobox').locator('option[value]:not([value=""])').count(),14);
 await page.locator('#profilePriorities').screenshot({path:'/tmp/swim-addon-site-choice.png'});
 assert.equal(state.planCalls.length,0);assert.deepEqual(state.errors,[]);
});
test('조회 실패·다른 기간 결과는 후보로 사용하지 않고, 현재 기간 불가로 바뀐 선택은 해제한다',async t=>{
 const {page,state}=await setup(t);const name=state.config.roomPriority[0].name;
 await addSite(page.locator('#roomList'),name);
 state.availability=state.config.roomPriority.map(room=>({name:room.name,available:false,status:'unavailable'}));await page.evaluate(()=>refreshAvailability());
 assert.equal(await page.locator('#roomList .site-choice-row').count(),0);
 await page.evaluate(()=>{availabilityContext='2000-01-01/1';for(const room of rooms)availabilityByRoom.set(room.name,'available');renderRooms();});
 assert.equal(await page.locator('#roomList select option[value]:not([value=""])').count(),0);
 await page.route('https://app.test/api/inspect',route=>route.fulfill({status:503,json:{error:'모의 조회 실패'}}));await page.evaluate(()=>refreshAvailability());
 assert.equal(await page.locator('#roomList select option[value]:not([value=""])').count(),0);
 assert.match(await page.locator('#roomList .site-choice-message').innerText(),/미확인은 0곳이 아닙니다/);
 assert.equal(state.planCalls.length,0);assert.deepEqual(state.errors,[]);
});
