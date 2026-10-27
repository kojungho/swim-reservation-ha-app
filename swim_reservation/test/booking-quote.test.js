import test from 'node:test';import assert from 'node:assert/strict';
import {parseQuote,parseQuoteDetail,bookingQuote} from '../src/booking-quote.js';
const config={startDate:'2026-12-22',nights:2,adults:2};
const html="<form class='side-summary js-quote' data-site='9' data-ci='2026-12-22' data-co='2026-12-24'><input name='ad' value='2'><div class='sum-row total'><span>총 금액</span><span>130,000원</span></div></form>";
const daily="<table class='night-table'><tr><td>12.22(화) <span class='t-weekday'>평일</span></td><td>60,000원</td></tr><tr><td>12.23(수) <span class='t-peak'>성수기</span></td><td>70,000원</td></tr></table>";
test('날짜별 구분·순서·박수·합계가 모두 맞는 내역만 표시한다',()=>{
 const source=html.replace('<div class=',daily+'<div class=');
 assert.deepEqual(parseQuoteDetail(source,config,9),{total:130000,nightlyRates:[{date:'2026-12-22',type:'평일',amount:60000},{date:'2026-12-23',type:'성수기',amount:70000}]});
 for(const bad of [source.replace('12.23','12.22'),source.replace('70,000원','60,000원'),source.replace('t-peak','t-weekend'),html])assert.deepEqual(parseQuoteDetail(bad,config,9),{total:130000,nightlyRates:[]});
 const cross=source.replaceAll('2026-12-22','2026-12-31').replaceAll('2026-12-24','2027-01-02').replace('12.22(화)','12.31(목)').replace('12.23(수)','1.1(금)');
 assert.equal(parseQuoteDetail(cross,{...config,startDate:'2026-12-31'},9).nightlyRates[1].date,'2027-01-01');
 const weekend=source.replaceAll('t-peak','t-weekend').replaceAll('성수기','주말');assert.equal(parseQuoteDetail(weekend,config,9).nightlyRates[1].type,'주말');
});
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
