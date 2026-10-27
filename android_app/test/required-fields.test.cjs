const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
const executablePath=process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
async function eachUi(t,check){
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');
 for(const phone of [true,false]){
  let page,errors,state;if(phone)({page,errors}=await setup(browser));else{page=await browser.newPage({viewport:{width:390,height:700}});state=await mockBookApp(page);errors=state.errors;}
  try{await page.waitForSelector('.booking-step-title');await page.evaluate(()=>{window.validationMessages=[];window.showFloatingMessage=text=>validationMessages.push(text);document.getElementById('reserverName').value='';document.getElementById('phone').value='';});await check(page,phone);assert.deepEqual(errors,[]);if(phone)assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>['run','stop','showKeyboard'].includes(c.action))),false);else assert.equal(state.planCalls.length,0);}finally{await page.close();}
 }
}
test('앱·애드온 빈 필수 입력을 스크롤로 지나 이력을 보아도 재안내·포커스·펼침 강제가 없다',async t=>eachUi(t,async page=>{
 await page.evaluate(()=>{document.getElementById('booking-step-body-1').hidden=true;document.querySelector('.booking-step-title').setAttribute('aria-expanded','false');window.scrollTo({top:0,behavior:'instant'});});
 await page.evaluate(()=>document.getElementById('historyCard').scrollIntoView({block:'start',behavior:'instant'}));await page.waitForTimeout(450);
 const before=await page.evaluate(()=>({y:scrollY,active:document.activeElement.id}));await page.waitForTimeout(1300);
 assert.deepEqual(await page.evaluate(()=>validationMessages),[]);assert.equal(await page.locator('#booking-step-body-1').evaluate(e=>e.hidden),true);assert.equal(await page.locator('#reserverName').getAttribute('aria-invalid'),null);
 assert.deepEqual(await page.evaluate(()=>({y:scrollY,active:document.activeElement.id})),before);
}));
test('입력 오류는 해당 칸 색상·플로팅만 표시하고 다음 포커스와 스크롤을 유지한다',async t=>eachUi(t,async page=>{
 await page.evaluate(()=>{document.getElementById('reserverName').focus();document.getElementById('depositorName').focus();});await page.waitForTimeout(200);
 assert.equal(await page.locator('#reserverName').getAttribute('aria-invalid'),'true');assert.match(await page.evaluate(()=>validationMessages.at(-1)),/예약자명/);assert.equal(await page.evaluate(()=>document.activeElement.id),'depositorName');
 await page.locator('#reserverName').fill('시험예약자');assert.equal(await page.locator('#reserverName').getAttribute('aria-invalid'),null);
 await page.evaluate(()=>{document.getElementById('phone').value='123';document.getElementById('phone').focus();document.getElementById('depositorName').focus();});await page.waitForTimeout(200);
 assert.equal(await page.locator('#phone').getAttribute('aria-invalid'),'true');assert.match(await page.evaluate(()=>validationMessages.at(-1)),/휴대폰/);assert.equal(await page.evaluate(()=>document.activeElement.id),'depositorName');
 await page.locator('#phone').fill('01000000000');assert.equal(await page.locator('#phone').getAttribute('aria-invalid'),null);
}));
test('다음 단계·등록은 누락을 막되 이동하지 않고 초기화 후 오류와 지연 안내를 해제한다',async t=>eachUi(t,async(page,phone)=>{
 await page.evaluate(()=>{document.getElementById('depositorName').focus();document.querySelectorAll('.booking-step-title')[1].click();});await page.waitForTimeout(200);
 assert.equal(await page.locator('#reserverName').getAttribute('aria-invalid'),'true');assert.equal(await page.evaluate(()=>document.activeElement.id),'depositorName');assert.equal(await page.locator('#booking-step-body-2').evaluate(e=>e.hidden),true);
 await page.evaluate(()=>{document.getElementById('reserverName').value='';document.getElementById('phone').value='';document.getElementById('addPlanButton').click();});await page.waitForTimeout(200);assert.match(await page.evaluate(()=>validationMessages.at(-1)),/예약자명/);
 await page.evaluate(()=>{window.beginBookingReset();document.getElementById('reserverName').value='';document.getElementById('phone').value='';window.finishBookingReset();window.validationMessages=[];});await page.waitForTimeout(350);
 assert.equal(await page.locator('#reserverName').getAttribute('aria-invalid'),null);assert.equal(await page.locator('#phone').getAttribute('aria-invalid'),null);assert.deepEqual(await page.evaluate(()=>validationMessages),[]);
 await page.locator('#bookingProfileSelect1').selectOption({index:1});await page.waitForTimeout(250);assert.notEqual(await page.locator('#reserverName').inputValue(),'');
}));
test('예약자 저장의 빈 필수칸은 색상·사유만 표시하며 입력칸으로 이동하지 않는다',async t=>eachUi(t,async page=>{
 await page.evaluate(()=>{document.getElementById('depositorName').focus();const button=document.getElementById('saveProfilesButton');button.disabled=false;button.click();});await page.waitForTimeout(200);
 assert.equal(await page.locator('#reserverName').getAttribute('aria-invalid'),'true');assert.equal(await page.locator('#phone').getAttribute('aria-invalid'),'true');assert.match(await page.evaluate(()=>validationMessages.at(-1)),/예약자명/);assert.equal(await page.evaluate(()=>document.activeElement.id),'depositorName');
}));
