const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
const executablePath=process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('앱·애드온 필수 입력: 벗어나기·다음 단계·스크롤 안내, 정상 입력 복구와 선택 항목 제외',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');
 for(const phone of [true,false]){
  let page,errors;if(phone)({page,errors}=await setup(browser));else{page=await browser.newPage({viewport:{width:390,height:900}});({errors}=await mockBookApp(page));}t.after(()=>page.close());await page.waitForSelector('.booking-step-title');
  await page.evaluate(()=>{window.validationMessages=[];window.showFloatingMessage=text=>validationMessages.push(text);document.getElementById('reserverName').value='';document.getElementById('phone').value='';});
  await page.locator('#reserverName').focus();await page.keyboard.press('Tab');
  await page.waitForFunction(()=>document.activeElement.id==='reserverName'&&document.activeElement.getAttribute('aria-invalid')==='true');assert.match(await page.evaluate(()=>validationMessages.at(-1)),/예약자명/);
  await page.locator('#reserverName').fill('시험예약자');assert.equal(await page.locator('#reserverName').getAttribute('aria-invalid'),null);
  await page.waitForTimeout(1250);await page.locator('.booking-step-title').nth(1).click({force:true});
  await page.waitForFunction(()=>document.activeElement.id==='phone'&&document.activeElement.getAttribute('aria-invalid')==='true');
  await page.locator('#phone').fill('123');await page.keyboard.press('Tab');await page.waitForFunction(()=>document.activeElement.id==='phone'&&document.activeElement.getAttribute('aria-invalid')==='true');
  await page.locator('#phone').fill('01000000000');assert.equal(await page.locator('#phone').getAttribute('aria-invalid'),null);
  await page.locator('#depositorName').fill('');await page.locator('#depositorName').focus();await page.keyboard.press('Tab');assert.equal(await page.locator('#depositorName').getAttribute('aria-invalid'),null);
  await page.evaluate(()=>{document.activeElement.blur();const input=document.getElementById('reserverName');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));window.scrollTo({top:0,behavior:'instant'});});await page.waitForTimeout(1300);
  await page.evaluate(()=>window.scrollTo({top:document.getElementById('reserverName').getBoundingClientRect().bottom+window.scrollY+100,behavior:'instant'}));
  await page.waitForFunction(()=>document.activeElement.id==='reserverName'&&document.activeElement.getAttribute('aria-invalid')==='true');
  assert.deepEqual(errors,[]);if(phone)assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>['run','stop','draftReset'].includes(c.action))),false);await page.close();
 }
});
test('처음부터 입력하지 않고 접힌 필수 구역을 실제 휠로 지나쳐도 다시 펼쳐 안내한다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');
 for(const phone of [true,false]){
  let page,errors;if(phone)({page,errors}=await setup(browser));else{page=await browser.newPage();({errors}=await mockBookApp(page));}t.after(()=>page.close());await page.setViewportSize({width:390,height:600});await page.waitForSelector('.booking-step-title');
  await page.evaluate(()=>{window.validationMessages=[];window.showFloatingMessage=text=>validationMessages.push(text);document.getElementById('reserverName').value='';document.getElementById('phone').value='';const body=document.getElementById('booking-step-body-1');body.hidden=true;document.querySelector('.booking-step-title').setAttribute('aria-expanded','false');window.scrollTo({top:0,behavior:'instant'});});
  await page.mouse.move(200,400);await page.mouse.wheel(0,1100);
  await page.waitForFunction(()=>document.activeElement.id==='reserverName'&&document.activeElement.getAttribute('aria-invalid')==='true');assert.equal(await page.locator('#booking-step-body-1').isVisible(),true);assert.ok(await page.evaluate(()=>validationMessages.length>0));assert.deepEqual(errors,[]);await page.close();
 }
});
test('예약 이력 제목과 오픈 전 명칭 입력, 바로 예약 명칭은 입실일 아닌 한국 예약일',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');
 for(const phone of [true,false]){
  let page,errors;if(phone)({page,errors}=await setup(browser));else{page=await browser.newPage();({errors}=await mockBookApp(page));}t.after(()=>page.close());await page.waitForSelector('.booking-step-title');
  const date=async value=>{await page.evaluate(({phone,value})=>{if(phone)loadPlan({mode:'reserve',date:value,name:'모의예약자',phone:'01000000000',rooms:'달_하늘존'});else{elements.reserverName.value='모의예약자';elements.phone.value='01000000000';elements.startDate.value=value;updateStayFields();renderRooms();}},{phone,value});await page.waitForTimeout(300);};
  await date('2027-01-22');assert.equal(await page.locator('#historyCard h2').first().textContent(),'예약 대기 일정 등록 및 예약 이력');assert.equal(await page.locator('#planName').isVisible(),true);assert.match(await page.locator('#planName').locator('..').textContent(),/예약 대기 일정 명칭/);await page.locator('#planName').fill('가족 대기');
  await date('2026-12-22');assert.equal(await page.locator('#planName').isVisible(),false);assert.match(await page.locator('#planName').inputValue(),/^2026-10-\d{2}$/);assert.notEqual(await page.locator('#planName').inputValue(),'2026-12-22');
  await date('2027-01-22');assert.equal(await page.locator('#planName').inputValue(),'가족 대기');assert.deepEqual(errors,[]);await page.close();
 }
});
