const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const PROBLEM_CODES=new Set('DIAGNOSTIC_TEST PAYMENT_METHOD_UNRECOGNIZED FORM_FIELDS_UNRECOGNIZED FORM_FIELDS_AMBIGUOUS FORM_VALIDATION_FAILED FORM_DOM_ERROR TERMS_UNRECOGNIZED FORM_MISMATCH FORM_UNRECOGNIZED LIST_UNRECOGNIZED CATALOG_MISMATCH PRE_SUBMIT_MISMATCH PREFLIGHT_SOURCE DOM_ERROR NOT_OPEN NO_ROOM NO_VACANCY PROFILE PLAN CONNECTION RENDERER SCRIPT TIMEOUT INTERRUPTED BACKGROUND_START CHECK_FAILED STOPPED BUSY EXECUTION_FAILED CHECK_REQUIRED HTTP_403 HTTP_429 HTTP_OTHER'.split(' '));
export function projectAppProblem(raw){
 const keys=['id','clientId','version','versionCode','category','state','code','stage','occurredAt'];
 if(!raw||Array.isArray(raw)||Object.keys(raw).length!==keys.length||keys.some(k=>!Object.hasOwn(raw,k))||!UUID.test(raw.id)||!UUID.test(raw.clientId)||typeof raw.version!=='string'||!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw.version)||!Number.isInteger(raw.versionCode)||raw.versionCode<1||raw.versionCode>100000||!['preflight','execution'].includes(raw.category)||!['failed','unavailable','check_required'].includes(raw.state)||!PROBLEM_CODES.has(raw.code)||!['listing','prepare','preflight','execution','unknown'].includes(raw.stage)||!Number.isSafeInteger(raw.occurredAt)||raw.occurredAt<1577836800000||raw.occurredAt>4102444800000)throw new Error('Invalid app problem');
 return Object.fromEntries(keys.map(k=>[k,raw[k]]));
}
export class AppProblems {
 constructor(store,now=Date.now){this.store=store;this.now=now;this.queue=Promise.resolve();this.minute=0;this.count=0;}
 accept(raw){const safe=projectAppProblem(raw);const task=this.queue.then(async()=>{
  if((await this.store.listLogs(1000)).some(e=>e.event==='app-problem'&&e.details?.id===safe.id))return {ok:true,id:safe.id};
  const minute=Math.floor(this.now()/60000);if(minute!==this.minute){this.minute=minute;this.count=0;}if(this.count>=20)throw Object.assign(new Error('Limited'),{statusCode:429});this.count++;
  const label=safe.category==='preflight'?'사전 점검':'예약 실행';
  const step={listing:'객실 조회',prepare:'예약자·결제·약관 입력',preflight:'입력값 최종 대조',execution:'실행 결과',unknown:'진행 단계 확인'}[safe.stage];
  const reason={DIAGNOSTIC_TEST:'진단 연결 시험 (실제 오류 아님)',PAYMENT_METHOD_UNRECOGNIZED:'무통장입금 항목 확인 실패',FORM_FIELDS_UNRECOGNIZED:'입력 항목 확인 실패',TERMS_UNRECOGNIZED:'필수 약관 확인 실패',NO_VACANCY:'점검용 빈자리 없음',INTERRUPTED:'점검 중단',TIMEOUT:'점검 시간 초과',HTTP_403:'사이트 접근 거부',HTTP_429:'사이트 요청 제한',EXECUTION_FAILED:'예약 실행 실패',CHECK_REQUIRED:'제출 결과 확인 필요'}[safe.code]||'진행 단계 확인 필요';
  await this.store.recordLog(safe.code==='DIAGNOSTIC_TEST'?'info':safe.state==='unavailable'?'warn':'error','app-problem',`앱 문제점 로그 · 익명 앱 보고 ${safe.clientId.slice(0,8)} · v${safe.version} · ${label} · ${step} · ${reason} (${safe.code})`,{...safe,source:'anonymous-app-report'});
  return {ok:true,id:safe.id};
 });this.queue=task.catch(()=>{});return task;}
}
