const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
const executablePath=process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('앱·애드온 이름 형식과 IME: ㄴ은 이름 칸으로 복귀, 조합 중 방해 없음, 완성 후 다음 단계',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');const{validPersonName}=await import('../../swim_reservation/src/person-name.js');
 for(const phone of [true,false]){
  let page,errors;if(phone)({page,errors}=await setup(browser));else{page=await browser.newPage({viewport:{width:390,height:900}});({errors}=await mockBookApp(page));}t.after(()=>page.close());await page.waitForSelector('.booking-step-title');
  const cases=['고중호','홍 길동','O’Neill','Jean-Luc','Jose\u0301','김'.normalize('NFD'),'王小明','','ㄴ','ㄱㅏ','홍ㄴ','ᄂ','홍123','123','홍😀','-홍','홍-','\u0301','홍\n길동','a'.repeat(51)];
  for(const value of cases)assert.equal(await page.evaluate(value=>validPersonName(value),value),validPersonName(value),value);
  await page.evaluate(()=>{document.getElementById('phone').value='01000000000';document.getElementById('startDate').value='';});await page.locator('#reserverName').fill('ㄴ');await page.keyboard.press('Tab');
  await page.waitForFunction(()=>document.activeElement.id==='reserverName'&&document.activeElement.getAttribute('aria-invalid')==='true');assert.match(await page.locator('#floatingMessage span').textContent(),/완성된 이름/);assert.equal(await page.locator('.booking-step-title').nth(1).getAttribute('aria-disabled'),'true');
  await page.evaluate(()=>{document.getElementById('floatingMessage').hidden=true;const name=document.getElementById('reserverName');name.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));name.value='고';name.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'고'}));});await page.waitForTimeout(250);
  assert.equal(await page.locator('.booking-step-title').nth(1).getAttribute('aria-disabled'),'true');assert.equal(await page.locator('#floatingMessage').isVisible(),false);
  await page.evaluate(()=>{const name=document.getElementById('reserverName');name.value='고중호';name.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'고중호'}));name.dispatchEvent(new InputEvent('input',{bubbles:true}));});await page.waitForFunction(()=>document.querySelectorAll('.booking-step-title')[1].getAttribute('aria-disabled')==='false');assert.equal(await page.locator('#reserverName').getAttribute('aria-invalid'),null);
  await page.locator('#reserverName').fill('ㄴ');await page.keyboard.press('Tab');await page.waitForFunction(()=>document.activeElement.id==='reserverName');
  if(!phone)await page.evaluate(()=>{bookingBook=bookingBook.map(p=>({...p,reserverName:'고중호'}));renderBookingProfileSelectors();});
  await page.locator('#bookingProfileSelect1').selectOption({index:1});await page.waitForFunction(()=>validPersonName(document.getElementById('reserverName').value));assert.deepEqual(errors,[]);if(phone)assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='run')),false);await page.close();
 }
});
