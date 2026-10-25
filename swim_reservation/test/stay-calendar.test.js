import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/stay-calendar.js',import.meta.url),'utf8');
const phone=await readFile(new URL('../../android_app/app/src/main/assets/ui/stay-calendar.js',import.meta.url),'utf8');
function model(fetch,now=()=>Date.parse('2026-10-25T10:00:00+09:00')){const context={window:{}};vm.runInNewContext(source,context);return new context.window.StayCalendarModel(fetch,now);}
test('앱과 애드온은 동일한 달력 모델을 사용한다',()=>assert.equal(source,phone));
test('마감 입실 금지, 퇴실일 제외, 중간 마감 차단, 예정·미확인과 취소 대기 구분',async()=>{
 const calendar=model(async month=>({month,openThrough:'2026-12-31',days:[{date:month+'-17',availableCount:3},{date:month+'-18',availableCount:0},{date:month+'-19',availableCount:4}]}));
 await calendar.load('2026-12');
 assert.equal(calendar.label('2026-12-17'),'3곳');assert.equal(calendar.label('2026-12-18'),'마감');
 assert.equal(calendar.allow('2026-12-18','start',''),false);
 assert.equal(calendar.allow('2026-12-18','end','2026-12-17'),true);
 assert.equal(calendar.allow('2026-12-19','end','2026-12-17'),false);
 assert.equal(calendar.allow('2026-12-19','end','2026-12-17',true),true);
 assert.equal(calendar.allow('2026-10-24','start','',true),false);
 assert.equal(calendar.allow('2026-12-25','end','2026-12-17',true),false);
 assert.equal(calendar.day('2026-12-20').state,'unknown');
 const planned=model(async month=>({month,openThrough:'2026-12-17',days:[{date:month+'-18',availableCount:0}]}));
 await planned.load('2026-12');assert.equal(planned.label('2026-12-18'),'예정');assert.equal(planned.allow('2026-12-18','start',''),true);assert.equal(planned.planned('2026-12-18'),true);
});
test('중복 조회 합치기·60초 만료·조회 실패는 0곳이 아님',async()=>{
 let calls=0,time=Date.parse('2026-10-25T00:00:00Z'),fail=false;
 const calendar=model(async month=>{calls++;if(fail)throw Error('403');return {month,days:[{date:month+'-31',availableCount:2}]};},()=>time);
 await Promise.all([calendar.load('2026-12'),calendar.load('2026-12')]);assert.equal(calls,1);
 await calendar.load('2026-12');assert.equal(calls,1);
 time+=60001;assert.equal(calendar.day('2026-12-31').state,'unknown');fail=true;
 await calendar.load('2026-12');assert.equal(calls,2);assert.equal(calendar.label('2026-12-31'),'미확인');
 assert.equal(calendar.allow('2027-01-01','end','2026-12-31'),true);
});
