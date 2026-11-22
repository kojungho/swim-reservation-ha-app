import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {mockBookApp} from './fixtures/ui-book-app.js';
import {prepareBookingReview,publicBookingJobs} from '../src/booking-card-review.js';
const executablePath=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/chromium'].find(existsSync);
test('one booking menu preserves legacy row semantics and card review uses editor conditions without starting a bank plan', {skip:!executablePath}, async t=>{
  const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());
  for(const width of [390,1280]){
    const page=await browser.newPage({viewport:{width,height:900}});const state=await mockBookApp(page);page.setDefaultTimeout(5000);
    assert.equal(await page.locator('[data-workspace-tab="priority"]').count(),0);
    assert.equal(await page.locator('[data-workspace-tab="multiple"]').count(),0);
    assert.equal(await page.evaluate(()=>workspaceTab),'profiles-parallel');
    const legacy={...state.config,bookingMode:'multiple',profiles:[state.book[0]],roomPriority:[{name:'해_하늘존',enabled:true},{name:'달_하늘존',enabled:true}]};
    await page.evaluate(c=>loadConfig(c),legacy);
    const rows=await page.evaluate(()=>readConfig().profiles.map(p=>({name:p.reserverName,sites:p.roomPriority.filter(r=>r.enabled).map(r=>r.name)})));
    assert.equal(rows.length,2);assert.equal(rows[0].name,rows[1].name);assert.deepEqual(rows.map(r=>r.sites),[['해_하늘존'],['달_하늘존']]);
    let jobs=[],starts=[];
    await page.route('https://app.test/api/card-review**',async route=>{
      const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
      if(path.endsWith('/booking-prepare')){jobs=await prepareBookingReview(body.config,{quote:async({roomNames})=>({quotes:roomNames.map(name=>({name,total:60000}))})});return route.fulfill({json:{id:'opaque',expiresAt:Date.now()+300000,jobs:publicBookingJobs(jobs)}});}
      if(path.endsWith('/booking-start')){starts.push(body);return route.fulfill({json:{review:{state:'browser'}}});}
      return route.fulfill({json:{csrf:'x'.repeat(64),vault:{configured:true},review:{state:'idle',busy:false,message:'검토 대기'}}});
    });
    await page.locator('#bookingPayment').selectOption('card-review');
    assert.equal(await page.locator('#addPlanButton').textContent(),'카드 결제 전 검토');
    await page.locator('#addPlanButton').click();await page.locator('#bookingCardDialog').waitFor({state:'visible'});
    assert.equal(jobs.length,2);assert.equal(state.plans.length,0);assert.equal(state.planCalls.length,0);
    await page.locator('#bookingCardConnect').click();assert.equal(starts.length,0);
    await page.locator('#bookingCardConsent').check();await page.locator('#bookingCardConnect').click();
    await page.waitForFunction(()=>document.querySelector('#bookingCardConnect').disabled===false);
    assert.equal(starts.length,1);assert.equal(starts[0].connectionOnly,true);assert.equal('passphrase' in starts[0],false);
    await page.locator('#bookingCardUnlock').fill('synthetic-unlock-only');await page.locator('#bookingCardFill').click();
    await page.waitForFunction(()=>document.querySelector('#bookingCardFill').disabled===false);
    assert.equal(starts.length,2);assert.equal(starts[1].connectionOnly,false);assert.equal(await page.locator('#bookingCardUnlock').inputValue(),'');
    assert.equal(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('synthetic-unlock-only')),false);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#bookingCardDialog').screenshot({path:'/tmp/swim-integrated-review-'+width+'.png'});
    await page.locator('#bookingCardClose').click();assert.deepEqual(state.errors,[]);await page.close();
  }
});
