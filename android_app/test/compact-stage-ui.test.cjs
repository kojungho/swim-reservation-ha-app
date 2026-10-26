const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
const executablePath=process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('앱·애드온 제목 펼침·필수 한 줄·상단 링크·오픈 전 시각·자동 선택창 1회',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 const {mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');
 for(const phone of [true,false])for(const width of [320,390,1280]){
  let page,errors,state;if(phone){({page,errors}=await setup(browser,width));}else{page=await browser.newPage({viewport:{width,height:900}});state=await mockBookApp(page);errors=state.errors;}
  t.after(()=>page.close());await page.waitForSelector('.booking-step-title');
  assert.equal(await page.locator('button.step-toggle').count(),0);
  if(phone)await page.evaluate(()=>loadPlan({mode:'reserve',date:'2027-01-17',name:'',phone:'',rooms:''}));
  else {await page.locator('#reserverName').fill('');await page.locator('#phone').fill('');await page.locator('#startDate').fill('2027-01-17');await page.locator('#startDate').dispatchEvent('change');}
  await page.waitForFunction(()=>document.querySelectorAll('.booking-step-title')[1].getAttribute('aria-disabled')==='false');
  await page.waitForTimeout(100);assert.equal(await page.locator('#triggerAt').isVisible(),true);
  assert.equal((await page.locator('#triggerAt').locator('..').textContent()).trim(),'예약 실행 시간(오픈 예정일)');
  assert.equal(await page.locator('#triggerAt').evaluate(el=>el.readOnly),true);
  assert.equal(await page.locator('#stayOpeningDate').isVisible(),false);
  await page.locator('#reserverName').fill('자동 전환 검증');await page.locator('#phone').fill('01000000000');
  const popup=page.locator('.site-choice-dialog');await popup.waitFor({state:'visible'});
  assert.equal(await page.locator('.booking-step-title').nth(2).getAttribute('aria-expanded'),'true');
  await popup.getByRole('button',{name:'취소',exact:true}).click();await page.waitForTimeout(1400);assert.equal(await popup.count(),0);
  const geometry=await page.locator('#reserverName').evaluate(input=>{const caption=input.closest('label').querySelector('.field-label-text'),tag=caption.querySelector('.required-tag'),a=caption.getBoundingClientRect(),b=tag.getBoundingClientRect();return {sameLine:Math.abs(a.y-b.y)<6,caption:caption.textContent,child:tag.parentElement===caption};});
  assert.ok(geometry.sameLine,JSON.stringify(geometry));assert.ok(geometry.child);assert.equal(geometry.caption.trim(),'예약자명(필수)');
  const links=await page.locator('.app-link-row').evaluate(row=>{const first=row.firstElementChild.getBoundingClientRect(),last=row.lastElementChild.getBoundingClientRect(),outer=row.getBoundingClientRect();return {sameLine:Math.abs(first.y-last.y)<5,right:outer.right-last.right,text:row.lastElementChild.textContent};});
  assert.ok(links.sameLine,JSON.stringify(links));assert.ok(links.right<5);assert.equal(links.text,'공식 예약 사이트');
  const compact=await page.locator('#roomList').evaluate(list=>{const button=list.querySelector('.site-choice-tools button'),body=list.closest('.booking-step-body'),b=button.getBoundingClientRect(),p=body.getBoundingClientRect();return {offset:b.x-p.x,body:p.height,button:b.height,actions:getComputedStyle(body.querySelector('.room-actions')).display};});
  assert.ok(compact.offset<5,JSON.stringify(compact));assert.equal(compact.actions,'none');assert.ok(compact.body<=compact.button+35,JSON.stringify(compact));
  const title=page.locator('.booking-step-title').nth(2);await title.click();assert.equal(await page.locator('#roomList').isVisible(),false);await title.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#roomList').isVisible(),true);
  assert.equal(await title.evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
  await page.locator('.booking-step-title').nth(0).click();await page.locator('.booking-step-title').nth(0).click();
  // Programmatic load models restoring an editor; it must not auto-open a picker.
  if(phone)await page.evaluate(()=>loadPlan({mode:'reserve',date:'2026-12-22',name:'자동 전환 검증',phone:'01000000000',rooms:''}));
  else await page.evaluate(()=>{elements.startDate.value='2026-12-22';updateStayFields();});
  await page.waitForTimeout(1400);assert.equal(await page.locator('#triggerAt').isVisible(),false);assert.equal(await page.locator('.site-choice-dialog').count(),0);
  assert.deepEqual(errors,[]);if(phone)assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='run')),false);else assert.equal(state.planCalls.length,0);
  if(width===390)await page.screenshot({path:phone?'/tmp/swim-phone-0413-layout.png':'/tmp/swim-addon-21518-layout.png',fullPage:true});
  await page.close();
 }
});
test('앱 다인 예약도 예약자 입력과 3번 사이트 선택을 분리하고 저장 예약자 선택 시 자동으로 연다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const {page,errors}=await setup(browser,390);t.after(()=>page.close());
 await page.waitForSelector('.booking-step-title');
 await page.evaluate(()=>loadPlan({mode:'profiles-parallel',date:'2027-01-17',name:'',phone:'',rooms:'',people:[{name:'',payer:'',phone:'',rooms:''}]}));
 await page.waitForTimeout(200);
 assert.equal(await page.locator('#phonePeople .site-choice-editor').count(),0);
 await page.locator('#phonePeople select[aria-label="예약자 1 저장 목록"]').selectOption('test-person');
 await page.locator('.site-choice-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#profilePriorities .phone-person-ranks').count(),1);
 assert.equal(await page.locator('.booking-step-title').nth(2).getAttribute('aria-expanded'),'true');
 await page.locator('.site-choice-dialog').getByRole('button',{name:'취소',exact:true}).click();await page.waitForTimeout(1300);
 assert.equal(await page.locator('.site-choice-dialog').count(),0);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='run')),false);
});
