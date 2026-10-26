import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright-core';import {mockBookApp} from './fixtures/ui-book-app.js';
const executablePath=process.env.CHROMIUM_PATH||'/usr/bin/chromium';
test('애드온도 사이트를 다중 선택한 뒤 완료에서만 반영하고 오류는 하단 플로팅으로 알린다',async t=>{
 const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
 for(const width of [320,390,1280]){const page=await browser.newPage({viewport:{width,height:900}}),state=await mockBookApp(page);state.availability=state.config.roomPriority.map(r=>({name:r.name,available:true,status:'available'}));await page.evaluate(()=>refreshAvailability());
  const picker=page.locator('#roomList');await picker.getByRole('button',{name:'사이트 선택',exact:true}).click();const dialog=page.locator('.site-choice-dialog');await dialog.locator('input').nth(0).check();await dialog.locator('input').nth(1).check();assert.equal(await picker.locator('.site-choice-row').count(),0);await dialog.getByRole('button',{name:'완료',exact:true}).click();assert.equal(await picker.locator('.site-choice-row').count(),2);
  await page.evaluate(()=>planMessage('모의 등록 실패',true));const toast=page.locator('#floatingMessage');assert.equal(await toast.isVisible(),true);assert.equal(await page.locator('#planMessage').isVisible(),false);const box=await toast.boundingBox();assert.ok(box.y>500&&box.y+box.height<900);
  await picker.getByRole('button',{name:'사이트 선택',exact:true}).click();await page.evaluate(()=>showFloatingMessage('선택 오류',{error:true}));assert.equal(await dialog.locator('#floatingMessage').isVisible(),true);await dialog.getByRole('button',{name:'취소',exact:true}).click();assert.equal(await picker.locator('.site-choice-row').count(),2);
  assert.deepEqual(state.errors,[]);assert.equal(state.planCalls.length,0);await page.close();
 }
});
