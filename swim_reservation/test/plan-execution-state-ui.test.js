import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mockBookApp, openPlanDetails } from './fixtures/ui-book-app.js';
const executablePath=process.env.CHROMIUM_PATH||'/usr/bin/chromium';
test('목록과 상세의 시작·중지·삭제는 실제 상태를 따르며 예정 시각과 서버 실행 조건을 안내한다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}}),state=await mockBookApp(page);
  const id='00000000-0000-0000-0000-000000000001';
  state.plans.push({id,name:'예약 상태 확인',kind:'scheduled',revision:'rev-1',enabled:false,config:state.config,status:{state:'stopped',stage:'stopped'}});
  await page.evaluate(()=>refreshPlans());
  const card=page.locator('[data-execution-plan-id="'+id+'"]'),button=action=>card.locator('[data-plan-action="'+action+'"]');
  assert.equal(await button('start').isEnabled(),true);assert.equal(await button('stop').isDisabled(),true);assert.equal(await button('delete').isEnabled(),true);
  assert.match(await card.locator('.execution-plan-time').innerText(),/2026-10-20 00:00:00.*한국 시간/);
  state.rejectDialogs=true;await button('start').click();assert.equal(state.planCalls.length,0);assert.equal(await button('start').isEnabled(),true);
  state.rejectDialogs=false;state.rejectStartPlan=id;await button('start').click();await page.waitForFunction(()=>!planDetailPending);
  assert.equal(await button('start').isEnabled(),true);assert.equal(await button('stop').isDisabled(),true);assert.match(await page.locator('#planMessage').innerText(),/시작 실패/);
  state.rejectStartPlan='';await button('start').click();await page.waitForFunction(()=>!planDetailPending);
  assert.match(state.dialogs.at(-1),/실행 예정: 2026-10-20 00:00:00 \(한국 시간\)/);assert.match(state.dialogs.at(-1),/서버 전원 꺼짐.*애드온 중지.*인터넷 단절/);assert.doesNotMatch(state.dialogs.at(-1),/배터리/);
  assert.equal(await button('start').isDisabled(),true);assert.equal(await button('stop').isEnabled(),true);assert.equal(await button('delete').isDisabled(),true);assert.match(await card.locator('small').innerText(),/예약 대기 중/);
  assert.equal(state.planCalls.at(-1).body.expectedRevision,'rev-1');
  for(const [native,stage,label] of [['waiting','prewarming','예약 준비 중'],['running','starting','예약 진행 중']]){state.plans[0].status={state:native,stage};await page.evaluate(()=>refreshPlans());assert.match(await card.locator('small').innerText(),new RegExp(label));assert.equal(await button('start').isDisabled(),true);assert.equal(await button('stop').isEnabled(),true);}
  await button('stop').click();await page.waitForFunction(()=>!planDetailPending);assert.equal(await button('start').isEnabled(),true);assert.equal(await button('delete').isEnabled(),true);assert.equal(await button('stop').isDisabled(),true);
  await openPlanDetails(page,0);assert.equal(await page.locator('[data-action=start]').isEnabled(),true);assert.equal(await page.locator('[data-action=stop]').isDisabled(),true);await page.locator('[data-action=start]').click();await page.waitForFunction(()=>!planDetailPending);
  assert.match(state.dialogs.at(-1),/2026-10-20 00:00:00/);assert.equal(await page.locator('[data-action=start]').isDisabled(),true);assert.equal(await page.locator('[data-action=delete]').isDisabled(),true);assert.equal(await page.locator('[data-action=stop]').isEnabled(),true);
  await page.locator('#planDetailsClose').click();await page.reload();await page.waitForFunction(()=>planEntries.length===1);assert.equal(await button('stop').isEnabled(),true);
  assert.equal(await card.evaluate(e=>e.scrollWidth<=e.clientWidth),true);assert.deepEqual(state.errors,[]);await page.close();
 }
});
test('감시·즉시·전체 시작도 감시 간격·종료 시각과 즉시 실행을 표시한다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());const page=await browser.newPage(),state=await mockBookApp(page);t.after(()=>page.close());
 state.plans.push({id:'00000000-0000-0000-0000-000000000001',name:'취소 대기',kind:'watch',intervalSeconds:600,watchEndsAt:'2026-12-19T18:00:00',enabled:false,config:state.config,status:{state:'stopped'}},{id:'00000000-0000-0000-0000-000000000002',name:'즉시 일정',kind:'now',enabled:false,config:state.config,status:{state:'stopped'}});
 await page.evaluate(()=>refreshPlans());await page.locator('#startAllPlans').click();await page.waitForFunction(()=>!planBatchPending);
 assert.match(state.dialogs.at(-1),/감시 시작: 시작 확인 후 바로 실행/);assert.match(state.dialogs.at(-1),/600초 간격/);assert.match(state.dialogs.at(-1),/감시 종료: 2026-12-19 18:00:00/);assert.match(state.dialogs.at(-1),/실행 예정: 시작 확인 후 바로 실행/);assert.equal(state.planCalls.length,2);assert.deepEqual(state.errors,[]);
});
