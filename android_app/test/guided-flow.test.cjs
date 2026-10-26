const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
const executablePath=process.env.CHROMIUM_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('단계별 필수 입력, 팝업만 일괄선택·삭제, 2열·짧은 이름, 선택 조회와 HA 읽기 표시',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 for(const width of [320,390,1280]){
  const {page,errors}=await setup(browser,width);t.after(()=>page.close());
  await page.waitForSelector('.booking-step-title');
  await page.evaluate(()=>loadPlan({mode:'reserve',date:'',name:'',phone:'',rooms:''}));
  await page.waitForFunction(()=>document.querySelectorAll('.booking-step-title')[1].disabled);
  assert.equal(await page.locator('#reserverName').isVisible(),true);assert.equal(await page.locator('#startDate').isVisible(),false);
  assert.deepEqual(await page.locator('.booking-step-title h2').allTextContents(),['예약자 정보','기간','객실 선택']);
  await page.evaluate(()=>{loadPlan({mode:'reserve',date:'2027-01-17',name:'',phone:'',rooms:''});});
  await page.waitForFunction(()=>document.querySelectorAll('.booking-step-title')[1].disabled);
  assert.equal(await page.locator('#roomList').isVisible(),false);
  await page.locator('#reserverName').fill('모의예약자');await page.locator('#phone').fill('01000000000');
  await page.waitForFunction(()=>!document.querySelectorAll('.booking-step-title')[2].disabled);
  assert.equal(await page.locator('#watchSelectAll').isVisible(),false);assert.equal(await page.locator('#inspectButton').isVisible(),false);
  // Completion of the required person fields automatically opens the picker.
  const popup=page.locator('.site-choice-dialog');await popup.waitFor();assert.equal(await popup.locator('.site-choice-option').count(),14);
  assert.equal(await popup.locator('.site-choice-option strong').filter({hasText:'존'}).count(),0);assert.equal(await popup.locator('.site-choice-option small').first().textContent(),'오픈 전');
  assert.equal(await popup.locator('.site-choice-options').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);
  await popup.getByRole('button',{name:'전체 선택',exact:true}).click();assert.equal(await popup.locator('input:checked').count(),14);
  await popup.getByRole('button',{name:'전체 삭제',exact:true}).click();assert.equal(await popup.locator('input:checked').count(),0);
  await popup.locator('input').first().check();await popup.getByRole('button',{name:'완료',exact:true}).click();
  assert.equal(await page.locator('.site-choice-row').first().evaluate(e=>e.firstElementChild.classList.contains('room-drag-handle')),true);
  const css=await page.locator('#campRequest').evaluate(e=>({width:e.getBoundingClientRect().width,parent:e.parentElement.getBoundingClientRect().width}));assert.ok(css.width<=css.parent);
  assert.equal(await page.locator('[data-workspace-tab=settings]').isVisible(),false);
  await page.locator('#siteMapButton').click();assert.equal(await page.locator('#mapGallery').isVisible(),false);assert.equal(await page.locator('#galleryDeleteAll').isVisible(),false);await page.locator('#siteMapCloseButton').click();
  await page.evaluate(()=>{nativeMock.state.haDisplay={cached:{settings:{appMenus:{priority:false,multiple:true,'profiles-parallel':false,watch:true},fonts:{body:17}},hasPhoto:false,updatedAt:1},message:'동기화 완료'};poll();});
  assert.equal(await page.locator('[data-workspace-tab=priority]').evaluate(e=>e.hidden),true);
  await page.evaluate(()=>{nativeMock.vault.profiles.push({id:'second',name:'다른 예약자',phone:'01011111111'});vault=nativeMock.vault;refreshLookupPeople();switchTab('people');});
  await page.locator('#phoneLookupPerson').selectOption('second');await page.getByRole('button',{name:'예약 조회',exact:true}).click();
  assert.equal(await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='lookup').at(-1).data.profiles.length),1);
  assert.equal(await page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='lookup').at(-1).data.profiles[0].id),'second');
  assert.equal(await page.getByRole('button',{name:'조회 중지',exact:true}).evaluate(e=>e.classList.contains('danger')),true);
  assert.equal(await page.locator('#lookupCard > details > summary').textContent(),'비회원 조회');
  assert.equal(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='run')),false);assert.deepEqual(errors,[]);
  if(width===390)await page.screenshot({path:'/tmp/swim-flow-phone-0412.png',fullPage:true});
 }
});
