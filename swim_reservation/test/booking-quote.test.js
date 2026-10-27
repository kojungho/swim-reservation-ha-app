import test from 'node:test';import assert from 'node:assert/strict';
import {parseQuote,bookingQuote} from '../src/booking-quote.js';
const config={startDate:'2026-12-22',nights:2,adults:2};
const html="<form class='side-summary js-quote' data-site='9' data-ci='2026-12-22' data-co='2026-12-24'><input name='ad' value='2'><div class='sum-row total'><span>총 금액</span><span>130,000원</span></div></form>";
test('견적은 같은 사이트·기간·인원과 하나의 공식 합계만 인정한다',()=>{
 assert.equal(parseQuote(html,config,9),130000);assert.equal(parseQuote(html,config,8),null);assert.equal(parseQuote(html,{...config,nights:1},9),null);assert.equal(parseQuote(html,{...config,adults:1},9),null);assert.equal(parseQuote(html+html,config,9),null);assert.equal(parseQuote(html.replace('130,000원','미확인'),config,9),null);
});
test('금액은 공개 GET만 사용하며 개인정보·예약 제출·자동 재시도는 없다',async()=>{
 const calls=[];const result=await bookingQuote({...config,roomNames:['샘_산맥존'],reserverName:'전송금지',phone:'전송금지'},{now:Date.parse('2026-10-27T00:00:00Z'),fetcher:async(url,options)=>{calls.push({url,options});return {ok:true,text:async()=>html};}});
 assert.equal(result.quotes[0].total,130000);assert.equal(calls.length,1);assert.match(calls[0].url,/\/camp\/site.php\?/);assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.body,undefined);assert.doesNotMatch(calls[0].url,/전송금지|name|phone|done.php|book.php/);
});
test('오픈 전에는 접속하지 않고 403·429는 반복 요청하지 않는다',async()=>{
 let count=0;const input={...config,roomNames:['샘_산맥존','산_하늘존']};const fetcher=async()=>{count++;return {ok:false,status:429};};
 await bookingQuote(input,{now:Date.parse('2026-09-01T00:00:00Z'),fetcher});assert.equal(count,0);
 const result=await bookingQuote(input,{now:Date.parse('2026-10-27T00:00:00Z'),fetcher});assert.equal(count,1);assert.ok(result.quotes.every(q=>q.total===null));
});
