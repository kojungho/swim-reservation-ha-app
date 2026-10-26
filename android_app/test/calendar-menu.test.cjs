const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
const executablePath=process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('앱·애드온 월말 입실은 다음 달 퇴실 달력으로 이동하며 월별 화면은 진입·월 변경마다 조회한다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');
 for(const phone of [true,false]){
  let page,errors,state;if(phone)({page,errors}=await setup(browser,390));else{page=await browser.newPage({viewport:{width:390,height:900}});state=await mockBookApp(page);errors=state.errors;}
  t.after(()=>page.close());let reads=0;await page.route('**/api/monthly-availability?**',route=>{reads++;const month=new URL(route.request().url()).searchParams.get('month');return route.fulfill({json:{month,countsOnly:true,openThrough:'2026-12-31',beforeOpen:true,days:Array.from({length:new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()},(_,i)=>({date:month+'-'+String(i+1).padStart(2,'0'),beforeOpen:true,availableCount:null,rooms:[]}))}});});
  await page.waitForSelector('.booking-step-title');
  for(const [start,end]of [['2027-01-31','2027-02-01'],['2027-12-31','2028-01-01'],['2028-02-29','2028-03-01']]){
   await page.evaluate(({phone,start})=>{if(phone)loadPlan({mode:'reserve',date:start,name:'모의예약자',phone:'01000000000',rooms:''});else{elements.reserverName.value='모의예약자';elements.phone.value='01000000000';elements.startDate.value=start;updateStayFields();}}, {phone,start});
   await page.locator('#startDate').click();await page.waitForFunction(date=>{const e=document.querySelector('[data-date="'+date+'"]');return e&&!e.disabled;},start);await page.locator('[data-date="'+start+'"]').click();
   await page.waitForFunction(date=>{const e=document.querySelector('[data-date="'+date+'"]');return e&&!e.disabled;},end);assert.match(await page.locator('#datePickerTitle').textContent(),/퇴실/);await page.locator('[data-date="'+end+'"]').click();assert.equal(await page.locator('#checkoutDate').inputValue(),end);
  }
  if(phone)assert.equal(await page.evaluate(()=>{$('startDate').value='2026-12-22';$('triggerAt').value='2027-01-01T00:00';updateStayFields();return readPlan().trigger;}),0);
  const count=()=>phone?page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='monthly').length):Promise.resolve(reads);
  const tab=async name=>page.evaluate(({phone,name})=>phone?switchTab(name):switchWorkspaceTab(name),{phone,name});
  await tab('monthly');await page.waitForTimeout(300);const first=await count();assert.ok(first>0);await tab('people');await tab('monthly');await page.waitForTimeout(300);assert.ok(await count()>first);
  const before=await count();await page.locator('#monthlyNextButton').click();await page.waitForTimeout(300);assert.ok(await count()>before);const second=await count();await page.locator('#monthlyMonth').fill('2027-02');await page.locator('#monthlyMonth').dispatchEvent('change');await page.waitForTimeout(300);assert.ok(await count()>second);
  assert.equal(await page.locator('#monthlyCacheInterval').count(),0);assert.equal(await page.locator('.monthly-legend .monthly-room-mark').count(),4);
  const size=await page.locator('#monthlyNextButton').evaluate(e=>{const r=e.getBoundingClientRect();return [r.width,r.height];});assert.deepEqual(size,[36,44]);assert.deepEqual(errors,[]);if(state)assert.equal(state.planCalls.length,0);else assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='run')),false);
 }
});
test('애드온에서 앱의 전체 8개 메뉴를 선택하고 앱에는 폰 실행 권한 메뉴를 남기지 않는다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{page,errors}=await setup(browser,390);t.after(()=>page.close());await page.waitForSelector('.booking-step-title');
 await page.evaluate(()=>{uiSettings.appMenus={priority:false,multiple:false,'profiles-parallel':false,watch:false,book:false,people:false,monthly:false,logs:false};applyBookingMenus(uiSettings);});
 assert.equal(await page.locator('#workspaceMenuLabel').textContent(),'메뉴 없음');assert.equal(await page.locator('.device-permissions').count(),0);
 assert.equal(await page.locator('[data-workspace-tab]').evaluateAll(es=>es.filter(e=>!e.hidden).length),0);
 await page.evaluate(()=>{uiSettings.appMenus.people=true;applyBookingMenus(uiSettings);});assert.equal(await page.locator('#workspaceMenuLabel').textContent(),'예약 조회');assert.equal(await page.locator('#lookupCard').isVisible(),true);assert.deepEqual(errors,[]);
 const{normalizeUiSettings}=await import('../../swim_reservation/src/ui-settings.js');const values=normalizeUiSettings({appMenus:{book:false,people:false,monthly:false,logs:false}});for(const name of ['book','people','monthly','logs'])assert.equal(values.appMenus[name],false);
});
