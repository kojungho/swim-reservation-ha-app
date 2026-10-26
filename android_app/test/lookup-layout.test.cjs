const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
test('앱·애드온 비회원 한 줄·접힘·상세 오른쪽·월별 가운데·날짜 없는 즉시 예약 숨김',async t=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});t.after(()=>browser.close());
 const {mockBookApp}=await import('../../swim_reservation/test/fixtures/ui-book-app.js');
 for(const phone of [true,false])for(const width of [320,390,1280]){
  let page,errors;if(phone)({page,errors}=await setup(browser,width));else{page=await browser.newPage({viewport:{width,height:900}});({errors}=await mockBookApp(page));}t.after(()=>page.close());
  await page.waitForSelector('.booking-step-title');await page.waitForTimeout(150);
  await page.evaluate(phone=>{if(phone){loadPlan({mode:'reserve',date:'',name:'',phone:'',rooms:''});switchTab('people');}else switchWorkspaceTab('people');},phone);
  const once=page.locator('.one-off-lookup');assert.equal(await once.evaluate(e=>e.open),false);
  await once.locator('summary').click();
  const layout=await once.locator('.nonmember-fields').evaluate(e=>{const r=[...e.children].map(x=>x.getBoundingClientRect());return {same:r.every(x=>Math.abs(x.y-r[0].y)<3),fits:r.at(-1).right<=e.getBoundingClientRect().right+1};});assert.ok(layout.same&&layout.fits,JSON.stringify(layout));
  await page.evaluate(()=>{const area=document.querySelector('#phoneLookupResults,#savedLookupArea');area.replaceChildren(...[1,2].map(id=>buildDisplayReceipt({id:String(id),room:'해_하늘존',stayDate:'2026-12-22',nights:'1박',status:'예약 확정',total:'60,000원'})));});
  const row=page.locator('.reservation-compact').first(),button=row.getByRole('button',{name:'상세',exact:true});
  const positions=await row.evaluate(e=>{const s=e.querySelector('.reservation-compact-state').getBoundingClientRect(),b=e.querySelector('button').getBoundingClientRect(),r=e.getBoundingClientRect();return {right:b.x>=s.right-1,compact:r.height<100};});assert.ok(positions.right&&positions.compact,JSON.stringify(positions));
  assert.equal(await row.locator('.reservation-more').isVisible(),false);await button.click();assert.equal(await row.locator('.reservation-more').isVisible(),true);await button.click();assert.equal(await row.locator('.reservation-more').isVisible(),false);
  if(width===390)await page.screenshot({path:phone?'/tmp/swim-phone-0415-lookup.png':'/tmp/swim-addon-21520-lookup.png',fullPage:true});
  await page.evaluate(phone=>{if(phone)switchTab('priority');else switchWorkspaceTab('priority');document.querySelector('#startDate').value='';},phone);await page.waitForTimeout(1400);
  assert.equal(await page.locator(phone?'[data-phone-run]':'#runNowButton').isVisible(),false);
  await page.evaluate(phone=>{if(phone)switchTab('monthly');else switchWorkspaceTab('monthly');},phone);
  await page.waitForTimeout(200);
  if(phone)await page.evaluate(()=>renderPhoneMonth({month:document.querySelector('#monthlyMonth').value,ok:true,openThrough:'2026-12-31',days:{}}));
  const center=await page.locator('#monthlyContent').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return Math.abs((r.left+r.right)-(p.left+p.right))/2;});assert.ok(center<2,'calendar offset '+center);
  if(phone){const table=await page.locator('.monthly-calendar').evaluate(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {center:Math.abs((r.left+r.right)-(p.left+p.right))/2,columns:e.querySelectorAll('thead th').length};});assert.ok(table.center<2);assert.equal(table.columns,7);}
  if(width===390)await page.screenshot({path:phone?'/tmp/swim-phone-0415-month.png':'/tmp/swim-addon-21520-month.png',fullPage:true});
  assert.deepEqual(errors,[]);await page.close();
 }
});
