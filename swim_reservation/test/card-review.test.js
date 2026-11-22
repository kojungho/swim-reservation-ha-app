import test from 'node:test';
import assert from 'node:assert/strict';
import {CardReview, reviewInput} from '../src/card-review.js';
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
