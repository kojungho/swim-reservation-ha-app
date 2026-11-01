import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { ReservationPreflight, preflightDue, preflightDates, preflightWindow, inspectReservationPreflight, dailyPreflightConfig, dailyPreflightDates } from '../src/reservation-preflight.js';
import { ReservationEngine } from '../src/camp-engine.js';
import { HaNotifications } from '../src/ha-notifications.js';

const epoch = value => Date.parse(value + '+09:00');
const config = { startDate: '2030-12-03', nights: 2, triggerAt: '2030-10-01T00:00:00', siteVersion: 'swimozicamp-v1', bookingMode: 'profiles-parallel', adults: 2,
  profiles: [{ reserverName: '모의예약자', phone: '01000000000', depositorName: '모의입금자' }, { reserverName: '다른예약자', phone: '01000000001', depositorName: '' }], roomPriority: [{ name: '산_하늘존', enabled: true }] };
const plan = () => ({ id: 'test-plan', enabled: true, kind: 'scheduled', config: structuredClone(config), status: { state: 'waiting', stage: 'armed' } });
test('자정 오픈 전날 오전10시, 한국시간08시 포함·19시 제외, 이미 열린 달만 후보', () => {
  assert.equal(preflightDue(epoch(config.triggerAt)), epoch('2030-09-30T10:00:00'));
  for (const [time, expected] of [['07:59:59', false], ['08:00:00', true], ['18:59:59', true], ['19:00:00', false], ['00:00:00', false]]) assert.equal(preflightWindow(epoch('2030-09-30T' + time)), expected);
  assert.ok(preflightDates(epoch('2030-09-30T10:00:00')).every(date => date < '2030-12-01'));
});
async function fixture(t, inspect = async () => ({ submitted: false })) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'swim-preflight-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let now = epoch('2030-09-30T09:59:59'), count = 0;
  const rows = [plan()], logs = [];
  const options = { dataDir: dir, now: () => now, list: async () => structuredClone(rows), engineFactory: () => ({ close: async () => {} }), log: async (...args) => logs.push(args), inspect: async (...args) => { count++; return inspect(...args); } };
  const manager = new ReservationPreflight(options); await manager.init(); t.after(() => manager.close());
  return { manager, options, rows, logs, set: value => { now = epoch(value); }, count: () => count };
}
test('대기 일정이 없어도 매일10시 한 번, 서버 재시작·설정 변경 중복 없음, 다음날 새 점검', async t => {
  const f=await fixture(t);f.rows.length=0;f.options.dailyConfig=async()=>dailyPreflightConfig(config);f.manager.dailyConfig=f.options.dailyConfig;
  await f.manager.tick();assert.equal(f.count(),0);f.set('2030-09-30T10:00:00');await Promise.all([f.manager.tick(),f.manager.tick()]);assert.equal(f.count(),1);assert.equal(f.logs[0][3].kind,'daily');
  const restored=new ReservationPreflight(f.options);await restored.init();await restored.tick();assert.equal(f.count(),1);await restored.close();
  f.set('2030-10-01T10:00:00');await f.manager.tick();assert.equal(f.count(),2);assert.equal(f.rows.length,0);assert.equal(f.manager.entries.length,2);
});
test('일일 점검은 야간·10시 전 실행하지 않고 지연 기동 시 주간에만 보충한다',async t=>{
  const f=await fixture(t);f.rows.length=0;f.manager.dailyConfig=async()=>dailyPreflightConfig(config);
  for(const time of ['00:00:00','07:59:59','09:59:59','19:00:00']){f.set('2030-09-30T'+time);await f.manager.tick();}assert.equal(f.count(),0);
  f.set('2030-09-30T18:00:00');await f.manager.tick();assert.equal(f.count(),1);
});
test('일일 점검 실패도 당일 반복하지 않고 다음날 다시 검사하며 예약에 영향이 없다',async t=>{
  const f=await fixture(t,async()=>{throw Object.assign(new Error('PRIVATE'),{code:'PAYMENT_METHOD_UNRECOGNIZED',step:'personal-fill'});});f.rows.length=0;f.manager.dailyConfig=async()=>dailyPreflightConfig(config);
  f.set('2030-09-30T10:00:00');await f.manager.tick();await f.manager.tick();assert.equal(f.count(),1);assert.equal(f.logs[0][3].state,'failed');assert.ok(!JSON.stringify(f.logs).includes('PRIVATE'));
  f.set('2030-10-01T10:00:00');await f.manager.tick();assert.equal(f.count(),2);
});
test('일일 설정 읽기 실패는 개인정보 원문 없이 기록·알림하고 브라우저를 열지 않는다',async t=>{
  const f=await fixture(t);f.rows.length=0;f.manager.dailyConfig=async()=>{throw new Error('PRIVATE_CONFIG');};f.set('2030-09-30T10:00:00');await f.manager.tick();assert.equal(f.count(),0);assert.equal(f.logs[0][3].code,'PREFLIGHT_CONFIG_UNAVAILABLE');assert.equal(f.logs[0][3].kind,'daily');assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_CONFIG'));
});
test('일일 점검도 실제 실행 직전·진행 중에는 양보하고 이후 같은 날 점검한다',async t=>{
  const f=await fixture(t);f.manager.dailyConfig=async()=>dailyPreflightConfig(config);f.set('2030-09-30T10:00:00');f.rows[0].config.triggerAt='2030-09-30T10:03:00';await f.manager.tick();assert.equal(f.count(),0);
  f.rows.length=0;f.manager.canCheck=()=>false;await f.manager.tick();assert.equal(f.count(),0);f.manager.canCheck=()=>true;await f.manager.tick();assert.equal(f.count(),1);
});
test('지난날 실행 중 서버가 종료된 일일 점검은 중단 알림 후 당일 새 검사',async t=>{
  const f=await fixture(t);f.rows.length=0;f.options.dailyConfig=async()=>dailyPreflightConfig(config);f.manager.dailyConfig=f.options.dailyConfig;f.set('2030-09-30T10:00:00');await f.manager.tick();
  f.manager.entries[0].state='checking';f.manager.entries[0].reported=false;await f.manager.persist();f.set('2030-10-01T08:00:00');const restored=new ReservationPreflight(f.options);await restored.init();await restored.tick();assert.equal(f.count(),1);assert.equal(f.logs.at(-1)[3].state,'interrupted');
  f.set('2030-10-01T10:00:00');await restored.tick();assert.equal(f.count(),2);await restored.close();
});
test('일일 점검 설정은 유효 예약자 한 명 또는 점검용 값을 복사하며 제출 동의·원래 설정을 바꾸지 않는다',()=>{
  const original=structuredClone(config),daily=dailyPreflightConfig(config);assert.equal(daily.profiles.length,1);assert.equal(daily.autoFinalSubmit,false);assert.equal(daily.preflightDaily,true);assert.equal(daily.startDate,'');assert.deepEqual(config,original);daily.profiles[0].phone='different';assert.equal(config.profiles[0].phone,'01000000000');
  const sample=dailyPreflightConfig({profiles:[]});assert.equal(sample.preflightProfileSource,'sample');assert.equal(sample.profiles[0].reserverName,'점검예약자');
});
test('달력 잔여 수로 후보를 찾고 과거·마감·아직 열리지 않은 날짜는 제외한다',async()=>{
  const urls=[],engine={traceStep:async(step,action)=>action(),navigate:async url=>{urls.push(url);const month=new URL(url).searchParams.get('ym');return{json:async()=>({ok:true,ym:month,open:'2030-10-31',days:{[month+'-05']:2,[month+'-06']:0}})};}};
  assert.deepEqual(await dailyPreflightDates(engine,epoch('2030-09-30T10:00:00')),['2030-10-05']);assert.equal(urls.length,3);
});
test('일일 정상은 로그만, 실패·미완료는 일일 점검 알림으로 전달한다',async()=>{
  const calls=[],n=new HaNotifications({token:'fake',fetchImpl:async(url,options)=>{calls.push(JSON.parse(options.body));return{ok:true};}});
  for(const state of ['passed','failed','unavailable'])n.observe({event:'preflight-result',details:{planId:'daily-health',kind:'daily',key:state,state,code:'PAYMENT_METHOD_UNRECOGNIZED',step:'personal-fill'}});
  await Promise.all([...n.pending]);assert.equal(calls.length,2);assert.ok(calls.every(call=>call.title.includes('일일 점검')));assert.ok(calls[0].message.includes('무통장입금'));
});
test('예약 전날 점검 한 번, 동시 tick·재시작 중복 없음, 원래 대기·설정 보존', async t => {
  const f = await fixture(t); const original = structuredClone(f.rows);
  await f.manager.tick(); assert.equal(f.count(), 0);
  f.set('2030-09-30T10:00:00'); await Promise.all([f.manager.tick(), f.manager.tick()]);
  assert.equal(f.count(), 1); assert.deepEqual(f.rows, original); assert.equal(f.logs.filter(e => e[1] === 'preflight-result').length, 1);
  const restored = new ReservationPreflight(f.options); await restored.init(); await restored.tick(); await restored.close(); assert.equal(f.count(), 1);
});
test('주간 등록 지연은 즉시, 야간에는 실행하지 않고 다음날08시 이후만 점검', async t => {
  const f = await fixture(t); f.rows[0].config.triggerAt = '2030-10-02T12:00:00';
  f.set('2030-10-01T20:00:00'); await f.manager.tick(); assert.equal(f.count(), 0);
  f.set('2030-10-02T07:59:59'); await f.manager.tick(); assert.equal(f.count(), 0);
  f.set('2030-10-02T08:00:00'); await f.manager.tick(); assert.equal(f.count(), 1);
});
test('중지·완료·감시·실행시각 경과·실행직전은 점검하지 않는다', async t => {
  const f = await fixture(t); f.set('2030-09-30T10:00:00');
  for (const change of [p => p.enabled = false, p => p.status.state = 'success', p => p.kind = 'watch', p => p.config.triggerAt = '2030-09-30T09:00:00', p => p.config.triggerAt = '2030-09-30T10:03:00']) {
    f.rows[0] = plan(); change(f.rows[0]); await f.manager.tick();
  }
  assert.equal(f.count(), 0);
});
test('점검 오류·빈자리 없음 구분, 대기 유지·raw개인정보 제외·자동 재시도 없음', async t => {
  const f = await fixture(t, async () => { throw Object.assign(new Error('SECRET name/phone'), { code: 'PAYMENT_METHOD_UNRECOGNIZED', step: 'personal-fill' }); });
  f.set('2030-09-30T10:00:00'); await f.manager.tick(); await f.manager.tick();
  assert.equal(f.count(), 1); assert.equal(f.rows[0].status.state, 'waiting'); assert.equal(f.manager.entries[0].state, 'failed'); assert.ok(!JSON.stringify(f.logs).includes('SECRET'));
  f.rows[0].config.adults = 3; f.manager.inspect = async () => { throw Object.assign(new Error('none'), { code: 'PREFLIGHT_NO_VACANCY' }); }; await f.manager.tick(); assert.equal(f.manager.entries.at(-1).state, 'unavailable');
});
test('점검 도중 중지하면 결과 알림을 억제하고 실제 예약 상태를 변경하지 않는다', async t => {
  let release; const f = await fixture(t, () => new Promise(resolve => { release = resolve; }));
  f.set('2030-09-30T10:00:00'); const checking = f.manager.tick();
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  f.rows[0].enabled = false; release({ submitted: false }); await checking; assert.equal(f.logs.length, 0); assert.equal(f.rows[0].status.state, 'waiting');
});
test('시간 제한은 실패로 알리고 종료, 재시작 checking은 중단 알림으로 한 번 처리', async t => {
  const f = await fixture(t, () => new Promise(() => {})); f.manager.timeoutMs = 10;
  f.set('2030-09-30T10:00:00'); await f.manager.tick(); assert.equal(f.manager.entries[0].code, 'PREFLIGHT_INTERRUPTED');
  f.manager.entries[0].state = 'checking'; f.manager.entries[0].reported = false; await f.manager.persist();
  const restored = new ReservationPreflight(f.options); await restored.init(); await restored.tick(); await restored.tick(); await restored.close();
  assert.equal(f.count(), 1); assert.equal(f.logs.length, 2);
});
test('사전점검 통과·문제·빈자리없음 HA알림, 원문 개인정보를 내보내지 않는다', async () => {
  const calls = []; const n = new HaNotifications({ token: 'fake', fetchImpl: async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true }; } });
  for (const state of ['passed', 'failed', 'unavailable']) n.observe({ event: 'preflight-result', details: { planId: state, key: 'key', state, code: 'PAYMENT_METHOD_UNRECOGNIZED', step: 'personal-fill', technicalMessage: 'SECRET', result: config } });
  await Promise.all([...n.pending]); assert.equal(calls.length, 3); assert.match(calls[0].title, /통과/); assert.match(calls[1].message, /무통장입금/); assert.match(calls[2].title, /미완료/); assert.ok(!/SECRET|01000000000|모의예약자/.test(JSON.stringify(calls)));
});

const executablePath = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
function form(url, malicious) {
  const q = new URL(url).searchParams;
  return `<div class="summary-card"><div class="sum-title">하늘존해</div></div><form class="js-book" method="post" action="/camp/book.php"><input name="_csrf" value="FAKE" type="hidden">${['site','checkin','checkout','adults','children','infants'].map((name, i) => `<input name="${name}" type="hidden" value="${[q.get('site'),q.get('ci'),q.get('co'),q.get('ad'),'0','0'][i]}">`).join('')}<input name="name" required><input name="phone" type="tel" required><input name="depositor"><textarea name="request"></textarea><select name="arrive_time"><option value=""></option></select><input name="pay_method" type="hidden" value="bank"><label><input name="agree_refund" class="js-agree" data-required="1" type="checkbox" required>필수 환불 규정</label><button class="js-pay" type="submit">최종 예약</button></form>${malicious ? '<script>document.querySelector("[name=name]").addEventListener("input",()=>fetch("/camp/book.php",{method:"POST",body:"attack"}).catch(()=>{}))</script>' : ''}`;
}
test('실제 엔진과 브라우저로 여러 예약자 최종검증까지 수행하지만 클릭·예약기록·POST는0', { skip: !executablePath }, async t => {
  t.mock.method(Date, 'now', () => epoch('2030-09-30T10:00:00'));
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  let writes = 0, records = 0; const logs = [];
  const engine = new ReservationEngine({ browserProvider: () => browser, store: { updateStatus: async () => {}, recordLog: async (...e) => logs.push(e), bookings: { begin() { records++; throw new Error('must not record'); } } } });
  await engine.ensurePage();
  await engine.context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() !== 'GET') { writes++; return route.abort(); }
    if (url.pathname === '/camp/book.php') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: form(req.url(), false) });
    const q = url.searchParams; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<div class="room-list"><a class="room-card" href="/camp/site.php?${q}&site=1"><span class="room-name">하늘존해</span></a></div>` });
  });
  const result = await inspectReservationPreflight(engine, config, epoch('2030-09-30T10:00:00'));
  assert.equal(result.submitted, false); assert.equal(result.profilesChecked, 2); assert.equal(writes, 0); assert.equal(records, 0); assert.equal(logs.filter(e => e[3]?.step === 'pre-submit-verify' && e[3].outcome === 'complete').length, 2); assert.ok(!logs.some(e => e[3]?.step === 'submit-click'));
});
test('사이트 스크립트가 입력 중 POST를 시도해도 네트워크에서 차단하고 통과로 보지 않는다', { skip: !executablePath }, async t => {
  t.mock.method(Date, 'now', () => epoch('2030-09-30T10:00:00'));
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close()); let writes = 0;
  const engine = new ReservationEngine({ browserProvider: () => browser, store: { updateStatus: async () => {}, recordLog: async () => {} } }); await engine.ensurePage();
  await engine.context.route('**/*', async route => {
    const req = route.request(); if (req.method() !== 'GET') { writes++; return route.abort(); }
    if (new URL(req.url()).pathname === '/camp/book.php') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: form(req.url(), true) });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<div class="room-list"><a class="room-card" href="/camp/site.php?${new URL(req.url()).searchParams}&site=1"><span class="room-name">하늘존해</span></a></div>` });
  });
  await assert.rejects(inspectReservationPreflight(engine, config, epoch('2030-09-30T10:00:00')), e => e.code === 'PREFLIGHT_WRITE_BLOCKED'); assert.equal(writes, 0);
});
test('일일 점검은 달력→실제 빈자리→동일 입력·약관·결제 검증까지 진행하고 제출은 없다',{skip:!executablePath},async t=>{
  t.mock.method(Date,'now',()=>epoch('2030-09-30T10:00:00'));const browser=await chromium.launch({executablePath,headless:true});t.after(()=>browser.close());let writes=0,calendars=0;const logs=[];
  const engine=new ReservationEngine({browserProvider:()=>browser,store:{updateStatus:async()=>{},recordLog:async(...e)=>logs.push(e),bookings:{begin(){throw new Error('must not record');}}}});await engine.ensurePage();await engine.context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(req.method()!=='GET'){writes++;return route.abort();}if(u.pathname==='/camp/api.php'){calendars++;const month=u.searchParams.get('ym');return route.fulfill({json:{ok:true,ym:month,open:'2030-11-30',days:{[month+'-05']:2}}});}if(u.pathname==='/camp/book.php')return route.fulfill({contentType:'text/html; charset=utf-8',body:form(req.url(),false)});return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div class="room-list"><a class="room-card" href="/camp/site.php?${u.searchParams}&site=1"><span class="room-name">하늘존해</span></a></div>`});});
  const result=await inspectReservationPreflight(engine,dailyPreflightConfig(config),epoch('2030-09-30T10:00:00'));assert.equal(result.checkin,'2030-10-05');assert.equal(result.submitted,false);assert.equal(calendars,3);assert.equal(writes,0);assert.ok(logs.some(e=>e[3]?.step==='pre-submit-verify'&&e[3].outcome==='complete'));assert.ok(!logs.some(e=>e[3]?.step==='submit-click'));
});
