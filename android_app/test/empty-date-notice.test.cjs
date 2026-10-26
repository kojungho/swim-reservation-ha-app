const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
test('앱·애드온 날짜 선택 전에는 박수 숨김, 선택하면 표시·초기화하면 다시 숨김',async t=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());const{mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');
 for(const phone of [true,false])for(const width of [320,390]){
  let page,errors,state;if(phone)({page,errors}=await setup(browser,width));else{page=await browser.newPage({viewport:{width,height:900}});state=await mockBookApp(page);errors=state.errors;}t.after(()=>page.close());await page.waitForSelector('.booking-step-title');
  const setDate=date=>page.evaluate(({date,phone})=>{if(phone)loadPlan({mode:'reserve',date,name:'모의예약자',phone:'01000000000',rooms:''});else{elements.reserverName.value='모의예약자';elements.phone.value='01000000000';elements.startDate.value=date;updateStayFields();}},{date,phone});
  await setDate('');await page.waitForTimeout(180);assert.equal(await page.locator('#stayNightsDisplay').isVisible(),false);assert.equal(await page.locator('[data-phone-run],#runNowButton').first().isVisible(),false);
  await setDate('2027-01-22');await page.waitForTimeout(180);assert.equal(await page.locator('#stayNightsDisplay').isVisible(),true);assert.equal(await page.locator('#stayNightsDisplay').textContent(),'1박');
  await setDate('');await page.waitForTimeout(180);assert.equal(await page.locator('#stayNightsDisplay').isVisible(),false);
  assert.doesNotMatch(await page.locator('#safetyNotice').textContent(),/같은 예약|동시에 실행|무통장/);
  if(!phone)assert.doesNotMatch(await page.evaluate(()=>planRunNotice({kind:'scheduled',config:{triggerAt:'2026-11-01T00:00'}})),/무통장|동시에 실행/);
  assert.deepEqual(errors,[]);if(phone)assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='run')),false);else assert.equal(state.planCalls.length,0);await page.close();
 }
});
