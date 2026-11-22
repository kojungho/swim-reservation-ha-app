import test from 'node:test';
import assert from 'node:assert/strict';
import {CardReview, reviewInput, waitInicisFrame, openIssuerPopup} from '../src/card-review.js';
test('popup rejection is handled immediately even while the click is pending',async()=>{
  const unhandled=[];const capture=e=>unhandled.push(e);process.on('unhandledRejection',capture);
  let finishClick;const error=Object.assign(new Error('synthetic timeout'),{name:'TimeoutError'});
  try {
    const pg={locator:()=>({waitFor:async()=>{},click:()=>new Promise(resolve=>{finishClick=resolve})})};
    await assert.rejects(openIssuerPopup({waitForEvent:()=>Promise.reject(error)},pg),{name:'TimeoutError'});
    await new Promise(resolve=>setImmediate(resolve));finishClick();assert.equal(unhandled.length,0);
  } finally {process.off('unhandledRejection',capture);}
});
test('stopping or timing out while Chromium launches cannot start an order afterward',async()=>{
  for(const timeout of [false,true]){
    let finishLaunch,closed=false,contextStarted=false;
    const review=new CardReview({launch:()=>new Promise(resolve=>{finishLaunch=resolve})});
    const card={cardNumber:'378282246310005',cvc:'123',password:'123456'};review.start({},card);
    if(timeout)await review.fail('REVIEW_TIMEOUT',review.generation);else await review.stop();
    finishLaunch({async close(){closed=true},async newContext(){contextStarted=true;assert.fail('must not start a context')}});await review.work;
    assert.equal(closed,true);assert.equal(contextStarted,false);assert.equal(review.busy,false);assert.equal(card.cardNumber,'');
  }
});
test('review uses an existing guest, exact amount below additional-auth threshold and explicit consent',()=>{
  const input={startDate:'2099-01-27',nights:1,siteId:1,profileIndex:0,amount:60000,consent:true};
  const profiles=[{reserverName:'검토자',phone:'01000000000'}];assert.equal(reviewInput(input,profiles).amount,60000);
  for(const patch of [{consent:false},{amount:300000},{profileIndex:99},{siteId:999},{nights:0}])assert.throws(()=>reviewInput({...input,...patch},profiles),{code:'REVIEW_INPUT'});
});
test('slow cleanup of an old failure cannot overwrite a newly started review',async()=>{
  let closeOld,finishLaunch;
  const review=new CardReview({launch:()=>new Promise(resolve=>{finishLaunch=resolve})});
  review.generation=1;review.busy=true;review.browser={close:()=>new Promise(resolve=>{closeOld=resolve})};review.stage('card');
  const failing=review.fail('REVIEW_FAILED',1);review.start({},{});closeOld();await failing;
  assert.equal(review.status().state,'browser');assert.equal(review.busy,true);
  await review.stop();finishLaunch({async close(){}});await review.work;
});
test('PG detection uses the navigated frame URL, including a form-target about:blank iframe',async()=>{
  const pg={url:()=> 'https://stdpay.inicis.com/payMain/pay'};let calls=0;
  const page={frames:()=>++calls===1?[{url:()=> 'about:blank'}]:[{url:()=> 'https://merchant.invalid/'},pg]};
  assert.equal(await waitInicisFrame(page,{sleep:async()=>{},timeout:1000}),pg);
  await assert.rejects(waitInicisFrame({frames:()=>[{url:()=> 'https://stdpay.inicis.com.evil.invalid/payMain/pay'}]},{sleep:async()=>{},timeout:0}),{code:'PG_FRAME_NOT_READY'});
  await assert.rejects(waitInicisFrame({frames:()=>[pg,pg]}),{code:'ORDER_MISMATCH'});
});
test('failure diagnostics expose only a fixed phase and failure type',async()=>{
  const records=[],review=new CardReview({log:async(...args)=>records.push(args)});review.generation=1;review.step='pg-frame';
  await review.fail('unknown-sensitive-error',1,'timeout');
  assert.equal(review.status().failedStep,'pg-frame');assert.equal(review.status().failureType,'timeout');assert.equal(review.status().code,'REVIEW_FAILED');
  assert.equal(JSON.stringify(records).includes('unknown-sensitive-error'),false);
});
