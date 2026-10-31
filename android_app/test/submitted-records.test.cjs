const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
test('앱·애드온 제출 당시 정보는 현재 예약자 수정과 무관하며 해당 정보로만 조회하고 삭제는 기록만 지운다',async t=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());const{mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');
 for(const phone of [true,false]){
  let page,errors,state;if(phone)({page,errors}=await setup(browser));else{page=await browser.newPage({viewport:{width:390,height:900}});state=await mockBookApp(page);errors=state.errors;}t.after(()=>page.close());
  let entries=[{id:'11111111-1111-4111-8111-111111111111',state:'complete',entered:{name:'제출예약자',phone:'01012345678',depositor:'제출입금자',request:'입력 원문',fields:[{role:'phone',name:'phone_v2',value:'010-1234-5678'}]},stay:{checkin:'2027-01-19',checkout:'2027-01-20',nights:1,site:'해_하늘존'},receipt:{id:'MOCK123',total:'60,000원',status:'입금 대기'}}],deletes=[];
  if(phone)await page.evaluate(entries=>{nativeMock.bookingRecords=entries;vault.profiles[0].name='다른예약자';switchTab('book');refreshBookingRecords();},entries);
  else{await page.route('https://app.test/api/booking-records**',route=>{if(route.request().method()==='DELETE'){deletes.push(route.request().url());entries=[];return route.fulfill({json:{ok:true}});}return route.fulfill({json:{entries}});});await page.evaluate(()=>{bookingBook[0].reserverName='다른예약자';switchWorkspaceTab('book');refreshBookingRecords();});}
  const card=page.locator('.submitted-booking-record');await card.waitFor();await card.locator('summary').click();assert.match(await card.textContent(),/제출예약자/);assert.match(await card.textContent(),/010-1234-5678/);assert.doesNotMatch(await card.textContent(),/다른예약자/);
  await card.getByRole('button',{name:'이 정보로 예약 조회',exact:true}).click();
  if(phone){const call=await page.evaluate(()=>nativeMock.calls.find(c=>c.action==='lookup'));assert.equal(call.data.profiles[0].name,'제출예약자');assert.equal(call.data.profiles[0].phone,'01012345678');await page.evaluate(()=>switchTab('book'));}
  else{await page.waitForFunction(()=>document.querySelector('#reservationList'));assert.equal(state.lookupRequests.at(-1).profiles[0].reserverName,'제출예약자');assert.equal(state.lookupRequests.at(-1).profiles[0].phone,'01012345678');await page.evaluate(()=>switchWorkspaceTab('book'));}
  await card.getByRole('button',{name:'기록 삭제',exact:true}).click();await card.getByRole('button',{name:'기록만 삭제',exact:true}).click();await card.waitFor({state:'detached'});
  if(phone)assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>['run','stop','cancel','profileDelete'].includes(c.action))),false);else{assert.equal(deletes.length,1);assert.ok(state.writes.every(path=>path==='/api/inspect'||path==='/api/reservations'));}assert.deepEqual(errors,[]);await page.close();
 }
});
