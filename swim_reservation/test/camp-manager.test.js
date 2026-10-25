import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { ReservationManager, reservationCheckUrl } from '../src/camp-manager.js';
import { readCampReservations } from '../src/camp-records.js';
import { catalog, CAMP_ROOT } from '../src/camp-site.js';
import { campReceipt } from './fixtures/camp-receipt.js';

const executablePath = [process.env.CHROMIUM_PATH, '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
const profile = { reserverName: '테스트예약자', phone: '01000000000' };
const lookupForm = `<div class="done-wrap"><div class="done-head"><h1>예약확인</h1></div><form class="lookup-form" method="post" action="${CAMP_ROOT}lookup.php"><input name="_csrf" value="FAKE-CSRF"><input name="name"><input name="phone"><button type="submit">조회하기</button></form></div>`;
async function setup(t, { result = campReceipt({ heading: '입금을 기다리고 있습니다' }), status = 200, form = lookupForm } = {}) {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  await context.route('**/*', route => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url(), body: request.postData() });
    if (request.url() !== reservationCheckUrl()) return route.abort();
    return route.fulfill({ status: request.method() === 'POST' ? status : 200, contentType: 'text/html; charset=utf-8', body: request.method() === 'POST' ? result : form });
  });
  const logs = [];
  const manager = new ReservationManager({ executablePath, log: async (...entry) => logs.push(entry) });
  manager.withPage = action => action(page);
  // Browser routing does not intercept APIRequestContext; never allow a real API
  // call from synthetic tests. Individual detail-list tests replace this stub.
  page.request.post = async () => { throw new Error('Unexpected API detail request in mock test'); };
  return { manager, page, requests, logs, close: () => browser.close() };
}
test('조회 주소에는 이름·전화번호·개별 토큰을 포함하지 않는다', () => {
  assert.equal(reservationCheckUrl(profile), `${CAMP_ROOT}lookup.php`);
});

function compactList(ids = ['TEST123-ABC', 'TEST456-XYZ', 'TEST789-PQR']) {
  return `<div class="done-wrap">${ids.map((id, index) => `<form method="post" class="summary-card lookup-pick" action="${CAMP_ROOT}lookup.php"><input type="hidden" name="_csrf" value="FAKE-CSRF"><input type="hidden" name="name" value="테스트예약자"><input type="hidden" name="phone" value="01000000000"><input type="hidden" name="pick" value="FAKE-PICK-${index}"><div class="sum-row"><span><span class="badge ${index ? 'confirmed' : 'pending'}">${index ? '예약확정' : '입금대기'}</span> ${id}</span><span>산맥존숨</span></div><div class="sum-row"><span>2026.12.22 ~ 2026.12.23 (1박)</span><span>60,000원</span></div><button type="submit" class="btn-line">자세히 보기</button></form>`).join('')}</div>`;
}
test('실제와 같은 요약 목록은 공개 번호 없는 확정 예약도 원본 pick 폼으로 상세 조회하고 토큰 없이 세 예약을 반환한다', { skip: !executablePath }, async t => {
  const f = await setup(t, { result: compactList().replaceAll('TEST456-XYZ', '').replaceAll('TEST789-PQR', '') });
  const calls = [];
  f.page.request.post = async (url, options) => {
    calls.push({ url, options });
    const index = Number(options.form.pick.slice(-1));
    const id = ['TEST123-ABC', 'TEST456-XYZ', 'TEST789-PQR'][index];
    return { ok: () => true, url: () => reservationCheckUrl(), headers: () => ({ 'content-type': 'text/html; charset=utf-8' }), text: async () => campReceipt({ id, state: index ? '예약확정' : '입금대기', heading: index ? '예약이 확정되었습니다' : '입금을 기다리고 있습니다' }) + '<script>window.privateDetailExecuted=true;fetch("/camp/book.php",{method:"POST"})</script>' };
  };
  const rows = await f.manager.list(profile);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.status), ['입금 대기', '예약 확정', '예약 확정']);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.url === reservationCheckUrl() && call.options.maxRedirects === 0 && call.options.maxRetries === 0));
  assert.ok(calls.every(call => call.options.form._csrf === 'FAKE-CSRF'));
  assert.equal(await f.page.evaluate(() => window.privateDetailExecuted), undefined);
  assert.ok(!JSON.stringify(rows).includes('FAKE-PICK'));
  assert.ok(!JSON.stringify(rows).includes('FAKE-CSRF'));
  assert.equal(f.requests.filter(request => request.method === 'POST').length, 1);
  const steps = f.logs.map(entry => entry[3]);
  assert.equal(new Set(steps.map(entry => entry.attemptId)).size, 1);
  for (const step of ['lookup-session', 'lookup-open', 'lookup-form-verify', 'lookup-fill', 'lookup-submit', 'lookup-result-parse', 'lookup-selections-verify', 'lookup-detail-fetch', 'lookup-detail-verify']) {
    assert.ok(steps.some(entry => entry.step === step && entry.outcome === 'complete'), step);
  }
  assert.deepEqual(steps.filter(entry => entry.step === 'lookup-detail-fetch' && entry.outcome === 'start').map(entry => entry.detailIndex), [0, 1, 2]);
  assert.ok(!/테스트예약자|01000000000|FAKE-CSRF|FAKE-PICK/.test(JSON.stringify(f.logs)));
});
test('공개 번호 없는 두 항목이 같은 상세 예약을 반환하면 부분 결과나 중복 예약으로 표시하지 않는다', { skip: !executablePath }, async t => {
  const f = await setup(t, { result: compactList().replaceAll('TEST456-XYZ', '').replaceAll('TEST789-PQR', '') });
  let calls = 0;
  f.page.request.post = async () => {
    calls++;
    return { ok: () => true, url: () => reservationCheckUrl(), headers: () => ({ 'content-type': 'text/html' }), text: async () => campReceipt({ id: 'TEST123-ABC' }) };
  };
  await assert.rejects(f.manager.list(profile), /식별값/);
  assert.equal(calls, 2);
});
test('요약 목록의 상세 429 또는 식별값 불일치에서는 나머지 상세를 조회하거나 일부를 전체 결과로 반환하지 않는다', { skip: !executablePath }, async t => {
  for (const scenario of ['rate-limit', 'wrong-id']) {
    const f = await setup(t, { result: compactList() });
    let calls = 0;
    f.page.request.post = async () => {
      calls++;
      return scenario === 'rate-limit' ? { ok: () => false, status: () => 429 } : { ok: () => true, url: () => reservationCheckUrl(), headers: () => ({ 'content-type': 'text/html' }), text: async () => campReceipt({ id: 'OTHER123-ABC' }) };
    };
    await assert.rejects(f.manager.list(profile), scenario === 'rate-limit' ? /HTTP 429/ : /식별값/);
    assert.equal(calls, 1);
    assert.ok(f.logs.some(entry => entry[3]?.step === (scenario === 'rate-limit' ? 'lookup-detail-fetch' : 'lookup-detail-verify') && entry[3]?.outcome === 'error'));
    await f.close();
  }
});
test('다른 예약자·개인정보 전송 주소·중복 pick·변경된 조회 버튼은 상세 조회 전에 차단한다', { skip: !executablePath }, async t => {
  for (const result of [compactList().replaceAll('테스트예약자', '다른예약자'), compactList().replaceAll(`action="${CAMP_ROOT}lookup.php"`, 'action="https://untrusted.test/lookup.php"'), compactList().replaceAll('FAKE-PICK-1', 'FAKE-PICK-0'), compactList().replaceAll('자세히 보기', '취소하기')]) {
    const f = await setup(t, { result });
    let calls = 0; f.page.request.post = async () => { calls++; throw new Error('Must not send'); };
    await assert.rejects(f.manager.list(profile));
    assert.equal(calls, 0);
    await f.close();
  }
});
test('사진과 같은 입금 대기 상세를 구조적으로 읽고 확정으로 오인하거나 취소 기능을 만들지 않는다', { skip: !executablePath }, async t => {
  const f = await setup(t);
  const rows = await f.manager.list(profile);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.id, 'TEST123-ABC');
  assert.equal(row.room, '숨_산맥존');
  assert.equal(row.stayDate, '2026-12-22');
  assert.equal(row.checkout, '2026-12-23');
  assert.equal(row.total, '60,000원');
  assert.equal(row.status, '입금 대기');
  assert.equal(row.paymentStatus, 'pending');
  assert.equal(row.cancelable, false);
  assert.equal(row.cancelPolicy, 'contact');
  assert.match(row.depositDeadline, /15:58/);
  const detail = await f.page.evaluate(readCampReservations, { expectedName: profile.reserverName, rooms: [...catalog.values()] });
  assert.equal(detail.submissionComplete, false);
  assert.ok(!JSON.stringify(row).includes('테스트용 계좌 원문'));
  assert.ok(!JSON.stringify(row).includes(profile.phone));
  const posts = f.requests.filter(request => request.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(new URLSearchParams(posts[0].body).get('_csrf'), 'FAKE-CSRF');
  assert.equal(new URLSearchParams(posts[0].body).get('name'), profile.reserverName);
});
test('입금 확인은 대기와 구분하고 완료 화면 제목만으로 입금 완료라 추정하지 않는다', { skip: !executablePath }, async t => {
  const f = await setup(t, { result: campReceipt({ state: '입금확인', heading: '예약이 확정되었습니다' }) });
  const [row] = await f.manager.list(profile);
  assert.equal(row.paymentStatus, 'confirmed');
  assert.equal(row.status, '입금 확인');
  assert.equal(row.depositDeadline, '');
});
test('명시적인 정상 빈 결과만 0건이며 입력 화면·다른 예약자·누락 상태·잘못된 날짜는 조회 실패다', { skip: !executablePath }, async t => {
  const empty = await setup(t, { result: '<div class="done-wrap"><div class="msg-box"><p>일치하는 예약 내역이 없습니다.</p></div></div>' });
  assert.deepEqual(await empty.manager.list(profile), []);
  await empty.close();
  const currentEmpty = await setup(t, { result: '<div class="done-wrap"><form class="lookup-form"><div class="form-error">일치하는 예약이 없습니다. 예약자명·연락처를 확인해 주세요.</div></form></div>' });
  assert.deepEqual(await currentEmpty.manager.list(profile), []);
  await currentEmpty.close();
  for (const result of [lookupForm, '<div class="done-wrap"><form class="lookup-form"><div class="form-error">잠시 후 다시 시도해 주세요.</div></form></div>', campReceipt({ name: '다른예약자' }) + '<p>테스트예약자</p>', campReceipt({ state: '처리중' }), campReceipt({ checkout: '2026.12.24' })]) {
    const f = await setup(t, { result });
    await assert.rejects(f.manager.list(profile), /일치 확인하지 못/);
    await f.close();
  }
});
test('403·429 응답은 조회 실패로 표시하고 추가 조회·개별 상세 이동·취소 요청을 하지 않는다', { skip: !executablePath }, async t => {
  for (const status of [403, 429]) {
    const f = await setup(t, { status });
    await assert.rejects(f.manager.list(profile), new RegExp(`HTTP ${status}`));
    assert.equal(f.requests.length, 2);
    assert.ok(f.requests.every(request => request.url === reservationCheckUrl()));
    await f.close();
  }
});
test('다른 전송 주소·CSRF 누락은 개인정보 제출 전에 거부한다', { skip: !executablePath }, async t => {
  for (const form of [lookupForm.replace(`action="${CAMP_ROOT}lookup.php"`, 'action="https://untrusted.test/lookup.php"'), lookupForm.replace('value="FAKE-CSRF"', 'value=""')]) {
    const f = await setup(t, { form });
    await assert.rejects(f.manager.list(profile), /보안 정보 또는 전송 주소/);
    assert.equal(f.requests.length, 1);
    await f.close();
  }
});
test('입력 오류는 개인정보 원문을 외부 오류 메시지에 보존하지 않는다', async () => {
  const manager = new ReservationManager({});
  manager.withPage = async () => { throw new Error('fill("비공개예약자") 01012345678 https://private.test/?t=SECRET'); };
  await assert.rejects(manager.list(profile), error => !/비공개예약자|01012345678|SECRET/.test(error.message));
});
test('여러 결과는 각 예약의 전체 구조가 확인될 때만 반환하고 중복 번호나 일부 실패는 버리지 않는다', { skip: !executablePath }, async t => {
  const item = options => `<article class="lookup-pick">${campReceipt(options).replace('<main class="done-wrap">', '<div>').replace('</main>', '</div>')}</article>`;
  const f = await setup(t);
  await f.page.goto(reservationCheckUrl());
  for (const [body, expected] of [[item({}) + item({ id: 'TEST456-XYZ', room: '산맥존결' }), 'list'], [item({}) + item({ name: '다른예약자' }), 'unknown'], [item({}) + item({}), 'unknown']]) {
    await f.page.setContent(`<div class="done-wrap">${body}</div>`);
    const parsed = await f.page.evaluate(readCampReservations, { expectedName: profile.reserverName, rooms: [...catalog.values()] });
    assert.equal(parsed.kind, expected);
    assert.equal(parsed.rows.length, expected === 'list' ? 2 : 0);
  }
});
