import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewGuard, samsungStep } from '../src/card-review-guard.js';
import { digitMap } from '../src/card-keypad.js';

test('only an exact Samsung issuer origin and known step are recognized',()=>{
  assert.equal(samsungStep('https://vbv.samsungcard.co.kr/VbV/xacsv2/WBVTFX301.jsp'),'301');
  for(const u of ['https://vbv.samsungcard.co.kr.evil.invalid/VbV/xacsv2/WBVTFX301.jsp','http://vbv.samsungcard.co.kr/VbV/xacsv2/WBVTFX301.jsp','https://vbv.samsungcard.co.kr/VbV/xacsv2/WBVTFX301.jsp/extra'])assert.equal(samsungStep(u),null);
});
test('one order POST, one card authentication navigation, no payment-return or unknown POST',()=>{
  const guard=new ReviewGuard(),order={url:'https://www.swimozicamp.com/camp/book.php',method:'POST',navigation:true};
  assert.equal(guard.allow(order),true);assert.equal(guard.allow(order),false);
  assert.equal(guard.allow({url:'https://vbv.samsungcard.co.kr/VbV/xacsv2/WBVTFX301.jsp',method:'POST',navigation:true}),true);
  for(const url of ['https://www.swimozicamp.com/camp/pay_return.php','https://www.swimozicamp.com/camp/done.php','https://stdpay.inicis.com/api/payAuth','https://vbv.samsungcard.co.kr/VbV/xacsv2/WBVTFX302.jsp','https://vbv.samsungcard.co.kr/VbV/xacsv2/WBVTFX301.jsp'])assert.equal(guard.allow({url,method:'POST',navigation:true}),false,url);
});
test('freeze blocks every domain, verb and navigation and sets browser offline',async()=>{
  const guard=new ReviewGuard();let offline=false;await guard.stopNetwork({async setOffline(value){offline=value}});assert.equal(offline,true);
  for(const host of ['www.swimozicamp.com','stdpay.inicis.com','vbv.samsungcard.co.kr','evil.invalid'])for(const method of ['GET','POST','PUT'])assert.equal(guard.allow({url:`https://${host}/VbV/xacsv2/WBVTFX301.jsp`,method,navigation:true}),false);
});
test('official INICIS CDN permits static GET assets only and remains blocked after freeze',()=>{
  const guard=new ReviewGuard(),url='https://stdux.inicis.com/stdpay/stdjs/INIStdPay_third-party.js';
  assert.equal(guard.allow({url}),true);
  assert.equal(guard.allow({url:"https://stdux.inicis.com/stdpay/pc/js/plugins.js"}),true);
  for(const input of [{url,method:'POST'},{url,navigation:true},{url:'https://stdux.inicis.com/payMain/pay'},{url:'https://stdux.inicis.com/stdpay/stdjs/result.jsp'},{url:'https://stdux.inicis.com.evil.invalid/stdpay/stdjs/INIStdPay_third-party.js'}]) assert.equal(guard.allow(input),false);
  guard.freeze();assert.equal(guard.allow({url}),false);
});
test('only official one-time PG render and issuer-init POSTs are allowed before the password screen',()=>{
  const guard=new ReviewGuard();
  for(const path of ['/payMain/pay','/payMain/Card','/jsApi/visa3d/before','/payAuthentication/visa3d']){
    const input={url:'https://stdpay.inicis.com'+path,method:'POST'};assert.equal(guard.allow(input),true);assert.equal(guard.allow(input),false);
  }
  for(const path of ['/payMain/done','/payMain/payDoneView','/jsApi/visa3d/after','/payMain/CardNext'])assert.equal(guard.allow({url:'https://stdpay.inicis.com'+path,method:'POST'}),false);
  const stopped=new ReviewGuard();stopped.reachedPassword=true;assert.equal(stopped.allow({url:'https://stdpay.inicis.com/jsApi/visa3d/before',method:'POST'}),false);
});
test('request interception includes popup requests and websocket rejection',async()=>{
  const guard=new ReviewGuard();let routeHandler,wsHandler;await guard.install({async route(pattern,h){assert.equal(pattern,'**/*');routeHandler=h},async routeWebSocket(pattern,h){wsHandler=h}});
  let aborted=false;await routeHandler({request:()=>({url:()=> 'https://evil.invalid/pay',method:()=> 'POST',isNavigationRequest:()=>true}),abort:async()=>{aborted=true},continue:async()=>assert.fail('unexpected network')});assert.equal(aborted,true);
  let closed=false;wsHandler({close:()=>{closed=true}});assert.equal(closed,true);
});
test('OCR must identify a complete unique set of ten keys; no guessed digits',()=>{
  const keys=Array.from({length:10},(_,i)=>({digit:String(i),x:i*40,y:20}));assert.equal(digitMap(keys).get('7').x,280);
  for(const invalid of [keys.slice(1),keys.map((k,i)=>i===9?{...k,digit:'8'}:k),keys.map((k,i)=>i===0?{...k,digit:'O'}:k)])assert.throws(()=>digitMap(invalid),{code:'KEYPAD_AMBIGUOUS'});
});
test('blocked-request diagnostics omit queries, session IDs, body data and unknown path identifiers',()=>{
  const guard=new ReviewGuard();guard.noteBlocked({url:()=> 'https://vbv.samsungcard.co.kr/VbV/xacsv2/WBVTFX301.jsp;jsessionid=do-not-retain?card=378282246310005&cvc=123',method:()=> 'POST'});
  guard.noteBlocked({url:()=> 'https://unknown.invalid/sensitive-user-secret',method:()=> 'POST'});
  assert.deepEqual(guard.recentBlocked,[{host:'vbv.samsungcard.co.kr',resource:'WBVTFX301.jsp',method:'POST'},{host:'external',resource:'unrecognized-resource',method:'POST'}]);
});
