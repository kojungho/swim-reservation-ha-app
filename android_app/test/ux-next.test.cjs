const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core'),{setup}=require('./fixtures/phone-ui.cjs');
const executablePath=process.env.CHROMIUM_PATH||'/usr/bin/chromium';
test('앱 오류는 하단 플로팅이고 약관 체크는 숨긴 채 시작 확인으로 처리한다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{page,errors}=await setup(browser);t.after(()=>page.close());
 assert.equal(await page.locator('.phone-consent').isVisible(),false);assert.equal(await page.evaluate(()=>readPlan().consent),true);
 await page.evaluate(()=>showError(Error('모의 오류 안내')));const toast=page.locator('#floatingMessage');assert.equal(await toast.isVisible(),true);assert.match(await toast.innerText(),/모의 오류/);assert.equal(await page.locator('#phoneError').isVisible(),false);
 const box=await toast.boundingBox();assert.ok(box.y>500&&box.y+box.height<900);await toast.getByRole('button',{name:'메시지 닫기'}).click();assert.equal(await toast.isVisible(),false);assert.deepEqual(errors,[]);
});
test('사이트 다중 선택은 완료 전 목록을 유지하고 완료 때 한 번에 반영하며 취소는 복원한다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 for(const width of [320,390,1280]){const{page,errors}=await setup(browser,width);
  await page.evaluate(()=>{nativeMock.state.availability={key:roomQueryKey(),ok:true,capturedAt:Date.now(),rooms:vault.rooms.map(name=>({name,available:true}))};poll();window.choiceChanges=0;document.addEventListener('roomorderchange',()=>choiceChanges++);});
  const picker=page.locator('#roomList'),before=await page.evaluate(()=>readPlan().rooms);await picker.getByRole('button',{name:'사이트 선택',exact:true}).click();
  const dialog=page.locator('.site-choice-dialog');for(const name of ['별_하늘존','빛_하늘존'])await dialog.locator('input[value="'+name+'"]').check();
  assert.equal(await page.evaluate(()=>readPlan().rooms),before);assert.equal(await page.evaluate(()=>choiceChanges),0);await dialog.getByRole('button',{name:'완료',exact:true}).click();assert.match(await page.evaluate(()=>readPlan().rooms),/별_하늘존, 빛_하늘존$/);assert.equal(await page.evaluate(()=>choiceChanges),1);
  await picker.getByRole('button',{name:'사이트 선택',exact:true}).click();await dialog.locator('input[value="강_하늘존"]').check();await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.doesNotMatch(await page.evaluate(()=>readPlan().rooms),/강_하늘존/);
  assert.equal(await picker.evaluate(e=>e.scrollWidth<=e.clientWidth),true);assert.deepEqual(errors,[]);await page.close();
 }
});
test('대기 일정이 있어도 달력 재열기·월 이동은 새 조회를 하고 실패 후 재시도한다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{page,errors}=await setup(browser);t.after(()=>page.close());
 await page.evaluate(()=>{Object.assign(nativeMock.state,{active:true,activeCount:1,capacity:5,multiProfile:true,stage:'WAITING'});$('startDate').value='2026-12-17';updateStayFields();poll();});
 await page.locator('#startDate').click();await page.waitForFunction(()=>document.querySelector('[data-date="2026-12-17"] small')?.textContent==='3곳');await page.locator('#datePickerCancel').click();
 const requests=()=>page.evaluate(()=>nativeMock.calls.filter(c=>c.action==='calendarMonth'&&c.data.month==='2026-12'&&c.data.force).length);const first=await requests();assert.ok(first>=1);
 await page.locator('#startDate').click();await page.waitForFunction(n=>nativeMock.calls.filter(c=>c.action==='calendarMonth'&&c.data.month==='2026-12'&&c.data.force).length>n,first);
 await page.locator('#datePickerNext').click();await page.waitForFunction(()=>document.querySelector('[data-date="2027-01-17"] small')?.textContent==='예정');assert.ok(await page.evaluate(()=>nativeMock.calls.some(c=>c.action==='calendarMonth'&&c.data.month==='2027-01'&&c.data.force)));
 await page.locator('#datePickerCancel').click();await page.evaluate(()=>{nativeMock.calendarData={'2026-12':{ok:false,month:'2026-12'}};});
 await page.locator('#startDate').click();await page.waitForSelector('#floatingMessage[data-error=true]:not([hidden])');await page.locator('#datePickerCancel').click();await page.evaluate(()=>{nativeMock.calendarData={};});await page.locator('#startDate').click();await page.waitForFunction(()=>document.querySelector('[data-date="2026-12-17"] small')?.textContent==='3곳');assert.deepEqual(errors,[]);
});
test('여러 활성 일정은 각자 중지하며 나머지 일정 시작은 5개 용량까지 가능하다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const{page,errors}=await setup(browser);t.after(()=>page.close());
 await page.evaluate(()=>{vault.plans=[1,2,3,4,5,6].map(i=>({id:'plan-'+i,title:'일정 '+i,plan:vault.draft}));Object.assign(nativeMock.state,{active:true,activeCount:2,capacity:5,multiProfile:true,runPlanId:'plan-1',stage:'WAITING',runs:[{planId:'plan-1',active:true,stage:'WAITING'},{planId:'plan-2',active:true,stage:'SUBMITTING'}]});renderPlans();poll();});
 const card=i=>page.locator('[data-plan-id="plan-'+i+'"]');assert.equal(await card(1).locator('[data-plan-action=start]').isDisabled(),true);assert.equal(await card(1).locator('[data-plan-action=stop]').isEnabled(),true);assert.equal(await card(2).locator('[data-plan-action=stop]').isEnabled(),true);assert.equal(await card(3).locator('[data-plan-action=start]').isEnabled(),true);assert.equal(await card(3).locator('[data-plan-action=stop]').isDisabled(),true);
 await page.evaluate(()=>{nativeMock.state.activeCount=5;poll();});assert.equal(await card(6).locator('[data-plan-action=start]').isDisabled(),true);assert.deepEqual(errors,[]);
});
