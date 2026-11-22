import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {CardReviewApi} from '../src/card-review-api.js';
function request(method,headers={},body={}){const r=Readable.from([Buffer.from(JSON.stringify(body))]);r.method=method;r.headers=headers;return r;}
function response(){return {writeHead(code,headers){this.code=code;this.headers=headers},end(body){this.body=JSON.parse(body)}};}
test('vault endpoints require a same-origin CSRF header and never expose saved card values',async()=>{
  const api=new CardReviewApi({dataDir:'/unused',store:{getSavedProfiles:async()=>[]},canStart:()=>true});api.vault.status=async()=>({configured:true,mode:'review-only'});
  const status=response();await api.handle(request('GET'),status,new URL('https://ha.invalid/api/card-review'));assert.equal(status.body.vault.configured,true);assert.equal('cardNumber' in status.body,false);
  for(const headers of [{},{'x-swim-card-review':api.csrf,'sec-fetch-site':'cross-site'}]){const out=response();await api.handle(request('PUT',headers,{cardNumber:'do-not-log'}),out,new URL('https://ha.invalid/api/card-review/vault'));assert.equal(out.code,403);assert.equal(JSON.stringify(out.body).includes('do-not-log'),false);}
});
test('status polling cannot release an in-flight private-operation lock',async()=>{
  const api=new CardReviewApi({dataDir:'/unused',store:{getSavedProfiles:async()=>[]},canStart:()=>true});api.pending=true;api.vault.status=async()=>({configured:false});
  await api.handle(request('GET'),response(),new URL('https://ha.invalid/api/card-review'));assert.equal(api.pending,true);
});
test('exceptions containing sensitive data are replaced with fixed public messages',async()=>{
  const api=new CardReviewApi({dataDir:'/unused',store:{getSavedProfiles:async()=>[]},canStart:()=>true});api.vault.save=async()=>{throw Error('PAN 378282246310005 CVC 123 password 123456')};
  const out=response();await api.handle(request('PUT',{'x-swim-card-review':api.csrf},{}),out,new URL('https://ha.invalid/api/card-review/vault'));assert.equal(out.code,400);assert.equal(out.body.code,'REVIEW_FAILED');assert.equal(JSON.stringify(out.body).includes('378282'),false);assert.equal(api.pending,false);
});
test('connection-only review never opens the saved card vault',async()=>{
  const api=new CardReviewApi({dataDir:'/unused',store:{getSavedProfiles:async()=>[{reserverName:'검토자',phone:'01000000000'}]},canStart:()=>true});
  api.vault.open=async()=>assert.fail('must not decrypt');let started=false;
  api.review.start=(config,card,options)=>{assert.deepEqual(card,{});assert.equal(options.connectionOnly,true);started=true;return {state:'browser'}};
  const out=response();await api.handle(request('POST',{'x-swim-card-review':api.csrf},{startDate:'2099-01-27',nights:1,siteId:1,profileIndex:0,amount:60000,consent:true}),out,new URL('https://ha.invalid/api/card-review/connection-test'));
  assert.equal(out.code,202);assert.equal(started,true);
});
test('connection preview rejects cross-site access, disables caching and expires without touching the vault',async()=>{
  const api=new CardReviewApi({dataDir:'/unused',store:{},canStart:()=>true});api.vault.open=async()=>assert.fail('must not decrypt');
  const png=Buffer.from('synthetic-png');api.review.previewBuffer=png;api.review.previewExpiresAt=Date.now()+10000;
  const url=new URL('https://ha.invalid/api/card-review/connection-preview.png');
  const denied=response();await api.handle(request('GET',{'sec-fetch-site':'cross-site'}),denied,url);assert.equal(denied.code,403);
  const out={...response(),end(body){this.body=body}};await api.handle(request('GET',{'sec-fetch-site':'same-origin'}),out,url);
  assert.equal(out.code,200);assert.equal(out.headers['Cache-Control'],'no-store');assert.equal(out.headers['Content-Type'],'image/png');assert.equal(out.body,png);
  api.review.previewExpiresAt=Date.now()-1;const expired=response();await api.handle(request('GET'),expired,url);assert.equal(expired.code,404);assert.ok(png.every(n=>n===0));
});
test('integrated booking requires unexpired server conditions, explicit consent and never decrypts diagnostic runs',async()=>{
  const api=new CardReviewApi({dataDir:'/unused',store:{},canStart:()=>true});
  api.vault.open=async()=>assert.fail('must not decrypt diagnostics');
  const config={startDate:'2099-01-27',nights:1,siteId:1,amount:60000,profileIndex:0,profile:{reserverName:'검토자',phone:'01000000000'}};
  api.booking={id:'test',expiresAt:Date.now()+60000,jobs:[config],attempted:new Set()};
  let count=0;api.review.start=(c,card,options)=>{assert.equal(c,config);assert.deepEqual(card,{});assert.equal(options.connectionOnly,true);count++;return {state:'browser',finalPaymentAttempted:false};};
  const headers={'x-swim-card-review':api.csrf},url=new URL('https://ha.invalid/api/card-review/booking-start');
  for(const body of [{id:'other',index:0,consent:true},{id:'test',index:0,consent:false}]){const out=response();await api.handle(request('POST',headers,body),out,url);assert.equal(out.code,400);}
  const body={id:'test',index:0,consent:true,connectionOnly:true,amount:1,siteId:14};
  const out=response();await api.handle(request('POST',headers,body),out,url);assert.equal(out.code,202);assert.equal(count,1);
  const repeat=response();await api.handle(request('POST',headers,body),repeat,url);assert.equal(repeat.body.code,'REVIEW_ALREADY_ATTEMPTED');assert.equal(count,1);
  api.booking.expiresAt=0;const expired=response();await api.handle(request('POST',headers,{...body,connectionOnly:false}),expired,url);assert.equal(expired.code,400);
});
