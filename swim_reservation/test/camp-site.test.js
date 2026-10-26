import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { ReservationEngine } from '../src/camp-engine.js';
import { CAMP_ROOT, campUrl, catalog, mergeListing } from '../src/camp-site.js';
import { parseCampCalendar } from '../src/camp-monthly.js';
import { normalizeConfig, validateConfig } from '../src/config.js';
import { Scheduler } from '../src/scheduler.js';
import { MonthCache } from '../src/month-cache.js';
import { campReceipt } from './fixtures/camp-receipt.js';

const executablePath = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
const config = () => normalizeConfig({ startDate: '2026-12-22', nights: 1, triggerAt: '2026-10-01T00:00:00', roomPriority: [{ name: '숨_산맥존', enabled: true }], profiles: [{ reserverName: '테스트예약자', phone: '01000000000' }] });
const form = `<form class="js-book" method="post" action="${CAMP_ROOT}book.php">
<input name="_csrf" value="fake-session-csrf"><input name="site" value="11"><input name="checkin" value="2026-12-22"><input name="checkout" value="2026-12-23"><input name="adults" value="2"><input name="children" value="0"><input name="infants" value="0">
<input name="name" required><input name="phone" required><input name="depositor"><textarea name="request"></textarea><select name="arrive_time"><option value=""></option></select><input type="radio" name="pay_method" value="bank"><input type="checkbox" class="js-agree" data-required="1" name="agree_refund" value="1"><aside class="summary-card"><div class="sum-title">산맥존숨</div></aside><button class="js-pay" type="submit">예약 신청하기</button></form>`;
const receipt = campReceipt();

test('새 사이트 1~14 번호와 기존 객실명을 연결하고 선택 날짜·박수로 링크를 생성한다', () => {
  assert.equal(catalog.get('해_하늘존').siteId, 1);
  assert.equal(catalog.get('숨_산맥존').siteId, 11);
  assert.equal(catalog.get('결_산맥존').siteId, 14);
  assert.equal(new URL(campUrl(config(), 'book.php', 11)).searchParams.get('co'), '2026-12-23');
  assert.deepEqual(validateConfig(config()), []); // No birthday or depositor required.
});
test('빈자리 목록의 없음은 예약완료가 아니며 잘못된 기간·형식은 0건으로 처리하지 않는다', () => {
  assert.ok(mergeListing({ recognized: true, cards: [] }, config()).every(room => room.status === 'unavailable'));
  assert.throws(() => mergeListing({ recognized: false, cards: [] }, config()));
  assert.throws(() => mergeListing({ recognized: true, cards: [{ href: campUrl({ ...config(), startDate: '2026-12-24' }, 'site.php', 11), displayName: '산맥존숨' }] }, config()));
});
test('월별 API의 오픈 전 양수 수치를 예약 가능으로 표시하지 않는다', () => {
  const data = parseCampCalendar({ ok: true, ym: '2027-01', open: '2026-12-31', days: { '2027-01-08': 14 } }, '2027-01');
  assert.equal(data.countsOnly, true);
  assert.equal(data.days[7].availableCount, null);
  assert.equal(data.days[7].beforeOpen, true);
  assert.ok(data.days[7].rooms.every(room => room.status === 'unknown'));
});
test('새 번호는 공개 목록에서 발견하면 후보에 추가하며 중복 번호 충돌은 거절한다', t => {
  t.after(() => catalog.delete('새사이트_산맥존'));
  const parsed = { recognized: true, cards: [{ href: campUrl(config(), 'site.php', 15), displayName: '산맥존새사이트' }] };
  assert.equal(mergeListing(parsed, config()).find(room => room.siteId === 15).name, '새사이트_산맥존');
  assert.throws(() => mergeListing({ recognized: true, cards: [{ ...parsed.cards[0], displayName: '산맥존다른이름' }] }, config()));
});
test('새 엔진의 예약 대기는 실행 전 사전 입력을 호출하지 않는다', async t => {
  let prepared = 0, now = Date.parse('2026-10-31T14:59:50Z');
  const scheduler = new Scheduler({ store: { updateStatus: async () => {} }, engine: { supportsPrewarm: false, prepare: async () => prepared++, close: async () => {} }, timeSync: { now: () => now, ensureSynced: async () => now } });
  t.after(() => scheduler.stop());
  await scheduler.arm({ ...config(), triggerAt: '2026-11-01T00:00:00' });
  scheduler.stopTimer();
  now += 5000;
  await scheduler.tick();
  assert.equal(prepared, 0);
});
test('월별 잔여 수 API 실패는 31개 날짜별 재조회로 확대하지 않는다', async () => {
  let calls = 0;
  const cache = new MonthCache({ dataDir: '/unused-test-path', countsOnly: true, inspect: async () => { calls++; throw new Error('HTTP 429'); } });
  await assert.rejects(cache.scan('2027-01', new AbortController().signal));
  assert.equal(calls, 1);
});
test('카드 결제와 예기치 못한 입력 오류를 자동 제출하거나 개인정보 로그로 남기지 않는다', async () => {
  const logs = [];
  const engine = new ReservationEngine({ store: { recordLog: async (...args) => logs.push(args) } });
  await assert.rejects(engine.runSingle({ ...config(), paymentMethod: 'card' }), error => error.code === 'MANUAL_PAYMENT_REQUIRED' && error.details.submitted === false);
  await assert.rejects(engine.traceStep('personal-fill', () => { throw new Error('fill("비공개예약자") 01012345678'); }));
  await engine.close();
  assert.ok(!JSON.stringify(logs).includes('비공개예약자'));
  assert.ok(!JSON.stringify(logs).includes('01012345678'));
});

async function fixture(t, { html = form, postStatus = 200, done = receipt } = {}) {
  const status = {}, logs = [], requests = [];
  const engine = new ReservationEngine({ executablePath, store: { updateStatus: async patch => Object.assign(status, patch), recordLog: async (...entry) => logs.push(entry) } });
  t.after(() => engine.close());
  await engine.ensurePage();
  await engine.context.route('**/*', async route => {
    const request = route.request(); requests.push({ method: request.method(), url: request.url(), data: request.postData() });
    const url = new URL(request.url());
    if (url.origin !== new URL(CAMP_ROOT).origin) return route.abort();
    // Use a fresh client navigation: Playwright may not route server redirect chains.
    if (request.method() === 'POST') return route.fulfill({ status: postStatus, contentType: 'text/html; charset=utf-8', body: postStatus === 200 ? `<script>location.href='${CAMP_ROOT}done.php?t=FAKE-PRIVATE-TOKEN'</script>` : 'Too many requests' });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: url.pathname.endsWith('/done.php') ? done : html });
  });
  return { engine, status, logs, requests };
}
test('오픈 반영 지연은 최대 5회 GET이며 중지 후 추가 조회·POST는 없다', { skip: !executablePath }, async t => {
  const notice='<div class="msg-box">아직 예약 오픈 전입니다.</div>';
  const f=await fixture(t,{html:notice});
  const current=()=>({...config(),triggerAt:new Date(Date.now()+9*3600000).toISOString().slice(0,19)});
  await assert.rejects(f.engine.runSingle(current()),e=>e.code==='BOOKING_NOT_OPEN');
  assert.equal(f.requests.filter(r=>r.method==='GET').length,5);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);
  const g=await fixture(t,{html:notice});let settled;const result=g.engine.runSingle(current()).then(()=>null,e=>e);
  while(!g.logs.some(entry=>entry[3]?.step==='opening-wait'&&entry[3]?.outcome==='start'))await new Promise(r=>setTimeout(r,20));
  await g.engine.close();settled=await result;assert.ok(settled);assert.equal(g.requests.length,1);
});
test('오픈 반영 재조회 중 폼이 열리면 진행하고 최종 제출은 1회만 한다', { skip: !executablePath }, async t => {
  const f=await fixture(t);let reads=0;
  await f.engine.context.route('**/camp/book.php?**',route=>{reads++;f.requests.push({method:route.request().method(),url:route.request().url()});return route.fulfill({contentType:'text/html; charset=utf-8',body:reads===1?'<div class="msg-box">아직 예약 오픈 전</div>':form});});
  await f.engine.runSingle({...config(),triggerAt:new Date(Date.now()+9*3600000).toISOString().slice(0,19)});
  assert.equal(reads,2);assert.equal(f.requests.filter(r=>r.method==='POST').length,1);assert.equal(f.status.state,'success');
});
test('실행 시각에 새 폼을 입력하고 필수 약관·무통장 제출 1회 및 영수증을 검증한다', { skip: !executablePath }, async t => {
  const f = await fixture(t);
  assert.equal(f.engine.supportsPrewarm, false);
  await f.engine.runSingle(config());
  const posts = f.requests.filter(request => request.method === 'POST');
  assert.equal(posts.length, 1);
  const body = new URLSearchParams(posts[0].data);
  assert.equal(body.get('depositor'), '테스트예약자');
  assert.equal(body.get('phone'), '01000000000');
  assert.equal(body.get('agree_refund'), '1');
  assert.equal(body.get('_csrf'), 'fake-session-csrf');
  assert.equal(f.status.state, 'success');
  assert.match(f.status.message, /입금 대기/);
  await f.engine.close();
  assert.ok(!JSON.stringify(f.logs).includes('FAKE-PRIVATE-TOKEN'));
  const steps = f.logs.filter(entry => entry[1] === 'booking-step').map(entry => entry[3]);
  for (const step of ['browser-ready', 'site-resolve', 'form-ready', 'form-verify', 'form-controls-check', 'personal-fields-fill', 'payment-select', 'terms-accept', 'input-verify', 'pre-submit-verify', 'consent-verify', 'submit-click', 'final-submit', 'receipt-verify']) {
    assert.ok(steps.some(entry => entry.step === step && entry.outcome === 'start'), step);
    assert.ok(steps.some(entry => entry.step === step && entry.outcome === 'complete'), step);
  }
  assert.ok(steps.some(entry => entry.step === 'pre-submit-verify' && entry.checks?.csrfPresent === true));
  assert.ok(!JSON.stringify(f.logs).includes('테스트예약자'));
  assert.ok(!JSON.stringify(f.logs).includes('01000000000'));
  assert.ok(JSON.stringify(f.logs).includes('010-****-0000'));
});
test('오픈 전 안내는 제출하지 않으며 페이지·폼 불일치도 제출하지 않는다', { skip: !executablePath }, async t => {
  for (const [html, code] of [[ '<div class="msg-box">12.31(목) 체크인까지 예약 가능합니다.</div>', 'BOOKING_NOT_OPEN' ], [form.replace('value="2026-12-22"', 'value="2026-12-24"'), 'FORM_MISMATCH']]) {
    const f = await fixture(t, { html });
    await assert.rejects(f.engine.runSingle(config()), error => error.code === code);
    await f.engine.close();
    if (code === 'FORM_MISMATCH') assert.ok(f.logs.some(entry => entry[3]?.checks?.checkin === false && entry[3]?.step === 'form-verify'));
    assert.equal(f.requests.filter(request => request.method === 'POST').length, 0);
  }
});
test('429 또는 완료 대조 실패 뒤 다른 객실로 재제출하지 않는다', { skip: !executablePath }, async t => {
  for (const options of [{ postStatus: 429 }, { done: receipt.replace('산맥존숨', '산맥존결') }]) {
    const f = await fixture(t, options);
    const input = config(); input.roomPriority.push({ name: '결_산맥존', enabled: true });
    await assert.rejects(f.engine.runSingle(input), error => ['SITE_RATE_LIMIT', 'COMPLETION_UNVERIFIED'].includes(error.code) && error.details.submitted === true);
    assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
  }
});
