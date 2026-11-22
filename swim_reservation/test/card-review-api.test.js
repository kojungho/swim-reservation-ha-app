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
