import { chromium } from 'playwright-core';
import { cardError } from './card-vault.js';
import { ReviewGuard, assertSamsungPage, samsungStep } from './card-review-guard.js';
import { fillKeypad, checkKeypad } from './card-keypad.js';
import { campUrl, checkoutDate, catalog } from './camp-site.js';
import { chromiumUserAgent } from './reservation-engine.js';

const MESSAGES = {
  idle: '삼성카드 검토 준비', browser: '검토 전용 브라우저 준비 중', order: '공식 예약 정보와 금액 확인 중',
  pg: '이니시스 결제창에서 삼성카드 선택 중', issuer: '삼성 인증창 연결 중', card: '카드번호 키패드 자동입력 중', cvc: 'CVC 키패드 자동입력 중',
  password: '비밀번호 화면 확인 · 승인 통신 차단 중', ready: '세 항목 자동입력 확인 · 최종 결제 전 정지 · 통신 차단됨',
  connected: '실제 사이트 연결·카드번호/CVC 키패드 확인 완료 · 카드 정보 입력 없음',
  'card-check': '카드번호 키패드 확인 중 · 입력 없음', 'cvc-check': 'CVC 키패드 확인 중 · 입력 없음',
  stopped: '검토 종료 · 브라우저와 입력값 폐기', failed: '검토를 중지했습니다. 카드 정보는 로그에 남기지 않았습니다.'
};
const STEPS = { browser:'브라우저 준비', 'order-open':'예약 화면 연결', 'order-check':'예약 조건 대조', 'order-fill':'예약자 입력', 'order-submit':'미결제 주문 생성', 'pg-frame':'이니시스 결제창 연결', 'pg-terms':'PG 필수 약관', 'pg-card':'삼성카드 선택', 'issuer-popup':'삼성 인증창 연결', 'issuer-mode':'일반결제 선택', 'issuer-summary':'가맹점·금액 대조', 'card-keypad':'카드번호 키패드', 'cvc-keypad':'CVC 키패드', 'card-auth':'카드 인증 및 비밀번호 화면 이동', 'password-keypad':'비밀번호 키패드', 'approval-block':'승인 통신 차단' };
export async function waitInicisFrame(page, { timeout = 15000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = Date.now() + timeout;
  do {
    const frames = page.frames().filter(frame => { try { const u = new URL(frame.url()); return u.origin === 'https://stdpay.inicis.com' && u.pathname === '/payMain/pay'; } catch { return false; } });
    if (frames.length === 1) return frames[0];
    if (frames.length > 1) throw cardError('ORDER_MISMATCH');
    await sleep(50);
  } while (Date.now() < deadline);
  throw cardError('PG_FRAME_NOT_READY');
}
export async function openIssuerPopup(page, pg) {
  const next = pg.locator('#CardBtn');
  await next.waitFor({state:'visible'});
  // Handle both promises immediately: a popup timeout must never become an
  // unhandled rejection while the initiating click is still waiting.
  const [issuer] = await Promise.all([page.waitForEvent('popup'), next.click()]);
  return issuer;
}
export async function cardInputControls(page) {
  const inputs = page.locator('input:not([type="hidden"])');
  const controls = await inputs.evaluateAll(elements => elements.map((e,index)=>{
    const text = [e.getAttribute('aria-label'),e.getAttribute('title'),e.getAttribute('placeholder'),...[...e.labels||[]].map(label=>label.textContent)].filter(Boolean).map(t=>t.replace(/\s+/g,''));
    const safe = s=>/^[A-Za-z_][A-Za-z0-9_-]{0,47}$/.test(s||'')?s:'other';
    return {index,id:safe(e.id),name:safe(e.name),type:['text','password','tel','number'].includes(e.type)?e.type:'other',visible:!!e.getClientRects().length,readOnly:e.readOnly,card:text.some(t=>/^카드번호(?:입력|\[-\]없이입력)?$/.test(t))||e.autocomplete==='cc-number',cvc:text.some(t=>/^CVC번호(?:입력|뒤3자리)?$/i.test(t))||e.autocomplete==='cc-csc'};
  }));
  const card = controls.filter(e=>e.visible&&e.card), cvc = controls.filter(e=>e.visible&&e.cvc);
  return {controls,card:card.length===1?inputs.nth(card[0].index):null,cvc:cvc.length===1?inputs.nth(cvc[0].index):null};
}
export async function connectionPreview(page, connectionOnly) {
  if(!connectionOnly||!page||samsungStep(page.url())!=='300') return null;
  if(!await page.locator('input:not([type="hidden"])').evaluateAll(es=>es.length>0&&es.every(e=>e.value.length===0))) return null;
  const png=await page.screenshot({fullPage:false});
  if(png.length>2000000){png.fill(0);return null;}
  return png;
}
export const REVIEW_ERRORS = {
  CARD_FORMAT: '카드번호·CVC 3자리·일반결제 비밀번호 6자리를 확인하세요.',
  VAULT_PASSPHRASE: '저장소 해제 암호는 12~256자로 입력하세요.', VAULT_OPEN_FAILED: '해제 암호 또는 저장소 파일을 확인하세요.',
  REVIEW_BUSY: '다른 예약·조회 또는 카드 검토가 진행 중입니다.', REVIEW_INPUT: '검토 날짜·사이트·예약자·금액과 동의를 확인하세요.',
  KEYPAD_OCR_FAILED: '키패드 숫자를 판독하지 못해 입력을 중지했습니다.', KEYPAD_AMBIGUOUS: '숫자 10개의 위치를 확실히 구별하지 못해 중지했습니다.',
  KEYPAD_MOVED: '키패드 위치가 바뀌어 입력을 중지했습니다.', KEYPAD_INPUT_UNVERIFIED: '키패드 입력 결과를 확인하지 못해 중지했습니다.',
  KEYPAD_NOT_READY: '삼성 보안 키패드가 초기화되지 않아 입력하지 않고 중지했습니다.',
  ISSUER_PAGE_MISMATCH: '예상한 삼성 일반결제 화면이 아닙니다. 추가 인증·등록은 직접 확인하세요.',
  ISSUER_FIELDS_UNRECOGNIZED: '삼성 카드번호·CVC 입력란을 유일하게 확인하지 못해 중지했습니다.',
  ORDER_MISMATCH: '공식 사이트의 객실·기간·인원·금액을 대조하지 못해 중지했습니다.',
  REVIEW_FAILED: '검토 중 화면 또는 연결 문제가 발생했습니다. 자동 재시도하지 않습니다.', REVIEW_TIMEOUT: '검토 제한 시간이 지나 브라우저를 닫았습니다.',
  PG_FRAME_NOT_READY: '이니시스 결제창의 실제 연결 주소를 확인하지 못해 중지했습니다.',
  FIELD_NOT_EMPTY: '입력란이 비어 있지 않아 중지했습니다.', VAULT_BUSY: '저장소 처리 중입니다. 잠시 후 다시 시도하세요.', VAULT_UNAVAILABLE: '암호화 저장소를 읽지 못했습니다.'
};
export function reviewInput(input, profiles) {
  const startDate = String(input.startDate || ''), nights = Number(input.nights), adults = Number(input.adults || 2);
  const siteId = Number(input.siteId), profileIndex = Number(input.profileIndex), amount = Number(input.amount);
  const profile = profiles[profileIndex], room = [...catalog.values()].find(room => room.siteId === siteId);
  try { checkoutDate(startDate, nights); } catch { throw cardError('REVIEW_INPUT'); }
  if (!room || !Number.isInteger(profileIndex) || !profile?.reserverName || !/^01\d{8,9}$/.test(String(profile.phone || '').replace(/\D/g, '')) || ![1, 2].includes(adults) || !Number.isSafeInteger(amount) || amount < 1 || amount >= 300000 || input.consent !== true) throw cardError('REVIEW_INPUT');
  if (startDate < new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)) throw cardError('REVIEW_INPUT');
  return { startDate, nights, adults, siteId, amount, roomName: room.name, profile: { reserverName: profile.reserverName, phone: String(profile.phone).replace(/\D/g, '') } };
}
export class CardReview {
  constructor({ executablePath = process.env.CHROMIUM_PATH || '/usr/bin/chromium', launch = options => chromium.launch(options), ocr, log = async () => {} } = {}) {
    Object.assign(this, { executablePath, launch, ocr, log }); this.busy = false; this.generation = 0;
    this.result = { state: 'idle', message: MESSAGES.idle, mode: 'review-only', finalPaymentAttempted: false };
  }
  preview() { if(this.previewBuffer&&Date.now()>this.previewExpiresAt){this.previewBuffer.fill(0);this.previewBuffer=null;}return this.previewBuffer||null; }
  status() { return { ...this.result, busy: this.busy, hasConnectionPreview:!!this.preview() }; }
  stage(state, extra = {}) { this.result = { state, message: MESSAGES[state], mode: 'review-only', finalPaymentAttempted: false, updatedAt: Date.now(), ...extra }; }
  async stop() { this.generation++; clearTimeout(this.timer); this.busy = false; this.stage('stopped');this.previewBuffer?.fill(0);this.previewBuffer=null; const browser = this.browser; this.browser = null; await browser?.close().catch(() => {}); }
  start(config, card, { fixture = null, connectionOnly = false } = {}) {
    if (this.busy) throw cardError('REVIEW_BUSY');
    this.busy = true; this.guard = null; this.pgFrame = null; this.pgControls = []; this.issuerControls = [];this.issuerPage=null;this.connectionOnly=connectionOnly;this.runtimeErrors=new Set();this.previewBuffer?.fill(0);this.previewBuffer=null; this.step = 'browser'; this.stage('browser'); const generation = ++this.generation;
    this.timer = setTimeout(() => { void this.fail('REVIEW_TIMEOUT', generation); }, 180000); this.timer.unref?.();
    this.work = this.run(config, card, fixture, generation, connectionOnly).catch(error => this.fail(error.code, generation, error.name === 'TimeoutError' ? 'timeout' : 'screen-or-connection')).finally(() => { for (const field of Object.keys(card)) card[field] = ''; });
    return this.status();
  }
  async fail(code, generation, failureType = 'screen-or-connection') {
    if (generation !== this.generation) return;
    this.generation++;
    clearTimeout(this.timer); this.busy = false; const browser = this.browser; this.browser = null;
    const preview=await connectionPreview(this.issuerPage,this.connectionOnly).catch(()=>null);
    const pgControls = this.step === 'pg-terms' && this.pgFrame ? await this.pgFrame.evaluate(() => ['inputChk7','inputChk3','inputChk4'].map(id=>{ const e=document.getElementById(id),label=document.querySelector('label[for="'+id+'"]');return {id,present:!!e,checkbox:e?.type==='checkbox',visible:!!e?.getClientRects().length,labelVisible:!!label?.getClientRects().length,checked:e?.checked===true}; })).catch(()=>[]) : this.pgControls || [];
    await browser?.close().catch(() => {});
    if (this.generation !== generation + 1) {preview?.fill(0);return;}
    this.previewBuffer=preview;this.previewExpiresAt=Date.now()+300000;
    const safeCode = Object.hasOwn(REVIEW_ERRORS, code) ? code : 'REVIEW_FAILED';
    const failedStep = Object.hasOwn(STEPS, this.step) ? this.step : 'browser';
    this.stage('failed', { code: safeCode, message: REVIEW_ERRORS[safeCode], failedStep, stepLabel: STEPS[failedStep], failureType, pgControls, issuerControls:this.issuerControls||[], runtimeErrors:[...this.runtimeErrors||[]], blockedRequests: this.guard?.recentBlocked || [] });
    await this.log('error', 'card-review', '카드 자동입력 검토 중지', { code: safeCode, failedStep, failureType }).catch?.(() => {});
  }
  async run(config, card, fixture, generation, connectionOnly = false) {
    const browser = await this.launch({ executablePath: this.executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=ko-KR'] });
    if (generation !== this.generation) { await browser.close(); return; }
    this.browser = browser;
    const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1000, height: 900 }, deviceScaleFactor: 3, serviceWorkers: 'block', userAgent: chromiumUserAgent(browser), acceptDownloads: false });
    context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(20000);
    const guard = new ReviewGuard(); this.guard = guard; await guard.install(context);
    // Offline synthetic test intercepts every request. Never forwards a request.
    if (fixture) await fixture.install(context, guard);
    context.on('page', page => { page.on('dialog', dialog => dialog.dismiss().catch(() => {})); page.on('download', download => download.cancel().catch(() => {}));page.on('pageerror',error=>{if(generation!==this.generation)return;const name=['ReferenceError','TypeError','SyntaxError'].includes(error.name)?error.name:'Error';const symbol=['npPfsCtrl','npPfsStartup','npVCtrl','nq'].find(s=>String(error.message).includes(s))||'other';this.runtimeErrors.add(name+':'+symbol);}); });
    const page = await context.newPage(); this.stage('order'); this.step = 'order-open';
    await page.goto(campUrl(config, 'book.php', config.siteId), { waitUntil: 'domcontentloaded' });
    this.step = 'order-check'; const form = page.locator('form.js-book');
    if (await form.count() !== 1) throw cardError('ORDER_MISMATCH');
    const room = [...catalog.values()].find(room => room.siteId === config.siteId);
    if (!room || (config.roomName && room.name !== config.roomName)) throw cardError('ORDER_MISMATCH');
    const matched = await form.evaluate((element, input) => {
      const value = name => element.querySelector(`[name="${name}"]`)?.value;
      const action = new URL(element.action), amount = [...element.innerText.matchAll(/총\s*(?:금액\s*)?([\d,]+)\s*원/g)].map(match => Number(match[1].replaceAll(',', '')));
      return action.origin === 'https://www.swimozicamp.com' && action.pathname === '/camp/book.php' && element.method.toLowerCase() === 'post' && Boolean(value('_csrf')) && value('site') === String(input.siteId) && value('checkin') === input.startDate && value('checkout') === input.checkout && value('adults') === String(input.adults) && value('children') === '0' && value('infants') === '0' && element.querySelector('.sum-title')?.textContent?.replace(/\s+/g,'') === input.displayName.replace(/\s+/g,'') && amount.length > 0 && amount.every(value => value === input.amount);
    }, { ...config, profile: undefined, checkout: checkoutDate(config.startDate, config.nights), displayName: room.displayName });
    if (!matched) throw cardError('ORDER_MISMATCH');
    this.step = 'order-fill'; await form.locator('[name="name"]').fill(config.profile.reserverName);
    await form.locator('[name="phone"]').fill(config.profile.phone);
    await form.locator('[name="pay_method"][value="card"]').check();
    await form.locator('[name="agree_refund"]').check();
    this.stage('pg');
    // Exactly one merchant order submission. Never native submit fallback/retry.
    this.step = 'order-submit'; await form.locator('button[type="submit"]').click();
    // The merchant POST can target an about:blank iframe without changing its src attribute.
    this.step = 'pg-frame'; const pg = await waitInicisFrame(page);
    this.pgFrame = pg;
    if (!pg || new URL(pg.url()).origin !== 'https://stdpay.inicis.com') throw cardError('ORDER_MISMATCH');
    this.step = 'pg-terms';
    for (const id of ['inputChk7', 'inputChk3', 'inputChk4']) {
      const control = pg.locator('#' + id), label = pg.locator('label[for="' + id + '"]');
      await control.waitFor({state:'attached'});
      const info = {id, count:await control.count(), visible:await control.isVisible(), labelCount:await label.count()}; this.pgControls.push(info);
      if (info.count !== 1 || await control.getAttribute('type') !== 'checkbox') throw cardError('ORDER_MISMATCH');
      if (info.visible) await control.check();
      else if (info.labelCount === 1 && await label.isVisible()) await label.click();
      else throw cardError('ORDER_MISMATCH');
      if (!await control.evaluate(e=>e.checked)) throw cardError('ORDER_MISMATCH');
    }
    this.step = 'pg-card'; await pg.getByRole('link', { name: '삼성카드', exact: true }).click();
    this.step = 'issuer-popup'; this.stage('issuer'); const issuer = await openIssuerPopup(page, pg);
    this.issuerPage=issuer;
    // Official PG popup first opens /checkWin.jsp and posts /payAuthentication/visa3d.
    await issuer.waitForURL(url => samsungStep(url.href) === '400');
    await issuer.waitForLoadState('domcontentloaded'); assertSamsungPage(issuer, '400');
    this.step = 'issuer-mode'; await issuer.getByRole('button', { name: /다른결제/ }).click();
    await issuer.getByRole('button', { name: /일반 결제 카드번호로 결제/ }).click();
    await issuer.waitForURL(url => samsungStep(url.href) === '300');
    assertSamsungPage(issuer, '300');
    this.step = 'issuer-summary'; const summary = await issuer.locator('body').innerText();
    if (!summary.includes('쉼오지캠프') || !summary.includes(config.amount.toLocaleString('en-US') + '원')) throw cardError('ORDER_MISMATCH');
    const fields = await cardInputControls(issuer); this.issuerControls = fields.controls;
    if (!fields.card || !fields.cvc) throw cardError('ISSUER_FIELDS_UNRECOGNIZED');
    if (connectionOnly) {
      this.step = 'card-keypad'; this.stage('card-check'); await checkKeypad(issuer, fields.card, { ocr: this.ocr });
      this.step = 'cvc-keypad'; this.stage('cvc-check'); await checkKeypad(issuer, fields.cvc, { ocr: this.ocr });
      if (!await issuer.locator('input:not([type="hidden"])').evaluateAll(elements => elements.every(e => e.value.length === 0))) throw cardError('FIELD_NOT_EMPTY');
      await guard.stopNetwork(context); this.stage('connected', { connectionOnly: true, networkBlocked: true, cardDataEntered: false });
      clearTimeout(this.timer); this.timer = setTimeout(() => { void this.stop(); }, 60000); this.timer.unref?.();
      await this.log('info','card-review','결제창 연결·키패드 검토 완료 · 카드 정보 입력 없음',{connectionOnly:true}); return;
    }
    this.step = 'card-keypad'; this.stage('card'); await fillKeypad(issuer, fields.card, card.cardNumber, { ocr: this.ocr });
    this.step = 'cvc-keypad'; this.stage('cvc'); await fillKeypad(issuer, fields.cvc, card.cvc, { ocr: this.ocr });
    const next = issuer.getByRole('button', { name: '다음', exact: true });
    if (!await next.isEnabled()) throw cardError('KEYPAD_INPUT_UNVERIFIED');
    this.step = 'card-auth'; await next.click(); await issuer.waitForURL(url => samsungStep(url.href) === '301'); assertSamsungPage(issuer, '301');
    this.step = 'password-keypad'; this.stage('password');
    const password = issuer.getByPlaceholder('숫자 6자리 입력', { exact: true });
    // Load and identify the keyboard, then block ALL network BEFORE entering a password.
    await fillKeypad(issuer, password, card.password, { ocr: this.ocr, beforeTyping: () => { this.step = 'approval-block'; return guard.stopNetwork(context); } });
    if (!await issuer.getByRole('button', { name: '결제하기', exact: true }).isEnabled()) throw cardError('KEYPAD_INPUT_UNVERIFIED');
    // Disable every submit affordance, independently of the network guard.
    await issuer.evaluate(() => { for (const element of document.querySelectorAll('button,input[type="submit"]')) { element.disabled = true; element.setAttribute('aria-disabled', 'true'); } document.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); }, true); });
    if (generation !== this.generation) return;
    if (fixture) await fixture.verifyFinalBoundary(issuer, guard);
    this.stage('ready', { fieldsVerified: { cardNumber: true, cvc: true, password: true }, networkBlocked: guard.frozen, fixture: Boolean(fixture), expiresAt: Date.now() + 60000 });
    clearTimeout(this.timer); this.timer = setTimeout(() => { void this.stop(); }, 60000); this.timer.unref?.();
    await this.log('info', 'card-review', '카드 자동입력 검토 완료 · 최종 결제 없음', { mode: 'review-only', fixture: Boolean(fixture) }).catch?.(() => {});
  }
}
