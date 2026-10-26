const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
const executablePath=process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('폰 네트워크 복구는 공개 설정만 재연결하고 예약을 시작하거나 폼을 초기화하지 않는다',async t=>{
 const b=await chromium.launch({executablePath,headless:true});t.after(()=>b.close());const{page,errors}=await setup(b,390);
 await page.waitForSelector('.booking-step-title');await page.evaluate(()=>loadPlan({mode:'reserve',date:'2027-01-22',name:'모의예약자',phone:'01000000000',rooms:''}));await page.locator('#planName').fill('보존할 작성 중 내용');
 const before=await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='haSync').length);
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.waitForFunction(n=>nativeMock.calls.filter(c=>c.action==='haSync').length>n,before);
 assert.equal(await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='haSync').some(c=>c.data?.reconnect===true)),true);
 assert.equal(await page.locator('#planName').inputValue(),'보존할 작성 중 내용');assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>['run','stop','draftReset'].includes(c.action))),false);assert.deepEqual(errors,[]);
 await page.locator('.official-site-link').click();assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='openMonthly')),true);assert.match(page.url(),/phone.swim.invalid/);
});
test('애드온 연결은 자동 복구하며 작성 중 입력·예약 대기를 변경하지 않는다',async t=>{
 const b=await chromium.launch({executablePath,headless:true});t.after(()=>b.close());const page=await b.newPage();const{mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');const state=await mockBookApp(page);
 await page.waitForSelector('.booking-step-title');await page.evaluate(()=>{elements.reserverName.value='모의예약자';elements.phone.value='01000000000';elements.startDate.value='2027-01-22';updateStayFields();renderRooms();});await page.locator('#planName').fill('보존할 일정 이름');
 await page.waitForFunction(()=>!statusRequestInFlight);
 await page.route('**/api/status',route=>route.abort('failed'));
 await page.evaluate(async()=>{nextStatusCheck=0;await refreshStatus();});
 await page.waitForFunction(()=>!document.getElementById('connectionNotice').hidden);assert.match(await page.locator('#connectionMessage').textContent(),/자동/);
 await page.unroute('**/api/status');await page.route('**/api/status',route=>route.fulfill({json:{state:'idle',stage:'idle'}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.waitForFunction(()=>document.getElementById('connectionNotice').hidden);
 assert.equal(await page.locator('#planName').inputValue(),'보존할 일정 이름');assert.equal(state.planCalls.length,0);assert.deepEqual(state.errors,[]);
});
