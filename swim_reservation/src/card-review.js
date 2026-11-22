import { chromium } from 'playwright-core';
import { cardError } from './card-vault.js';
import { ReviewGuard, assertSamsungPage, samsungStep } from './card-review-guard.js';
import { fillKeypad } from './card-keypad.js';
import { campUrl, checkoutDate, catalog } from './camp-site.js';
import { chromiumUserAgent } from './reservation-engine.js';

const MESSAGES = {
  idle: '삼성카드 검토 준비', browser: '검토 전용 브라우저 준비 중', order: '공식 예약 정보와 금액 확인 중',
  pg: '이니시스 결제창에서 삼성카드 선택 중', card: '카드번호 키패드 자동입력 중', cvc: 'CVC 키패드 자동입력 중',
  password: '비밀번호 화면 확인 · 승인 통신 차단 중', ready: '세 항목 자동입력 확인 · 최종 결제 전 정지 · 통신 차단됨',
  stopped: '검토 종료 · 브라우저와 입력값 폐기', failed: '검토를 중지했습니다. 카드 정보는 로그에 남기지 않았습니다.'
};
export const REVIEW_ERRORS = {
  CARD_FORMAT: '카드번호·CVC 3자리·일반결제 비밀번호 6자리를 확인하세요.',
  VAULT_PASSPHRASE: '저장소 해제 암호는 12~256자로 입력하세요.', VAULT_OPEN_FAILED: '해제 암호 또는 저장소 파일을 확인하세요.',
  REVIEW_BUSY: '다른 예약·조회 또는 카드 검토가 진행 중입니다.', REVIEW_INPUT: '검토 날짜·사이트·예약자·금액과 동의를 확인하세요.',
  KEYPAD_OCR_FAILED: '키패드 숫자를 판독하지 못해 입력을 중지했습니다.', KEYPAD_AMBIGUOUS: '숫자 10개의 위치를 확실히 구별하지 못해 중지했습니다.',
  KEYPAD_MOVED: '키패드 위치가 바뀌어 입력을 중지했습니다.', KEYPAD_INPUT_UNVERIFIED: '키패드 입력 결과를 확인하지 못해 중지했습니다.',
  ISSUER_PAGE_MISMATCH: '예상한 삼성 일반결제 화면이 아닙니다. 추가 인증·등록은 직접 확인하세요.',
  ORDER_MISMATCH: '공식 사이트의 객실·기간·인원·금액을 대조하지 못해 중지했습니다.',
  REVIEW_FAILED: '검토 중 화면 또는 연결 문제가 발생했습니다. 자동 재시도하지 않습니다.', REVIEW_TIMEOUT: '검토 제한 시간이 지나 브라우저를 닫았습니다.',
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
  status() { return { ...this.result, busy: this.busy }; }
  stage(state, extra = {}) { this.result = { state, message: MESSAGES[state], mode: 'review-only', finalPaymentAttempted: false, updatedAt: Date.now(), ...extra }; }
  async stop() { this.generation++; clearTimeout(this.timer); this.busy = false; this.stage('stopped'); const browser = this.browser; this.browser = null; await browser?.close().catch(() => {}); }
  start(config, card, { fixture = null } = {}) {
    if (this.busy) throw cardError('REVIEW_BUSY');
    this.busy = true; this.stage('browser'); const generation = ++this.generation;
    this.timer = setTimeout(() => { void this.fail('REVIEW_TIMEOUT', generation); }, 180000); this.timer.unref?.();
    this.work = this.run(config, card, fixture, generation).catch(error => this.fail(error.code, generation)).finally(() => { for (const field of Object.keys(card)) card[field] = ''; });
    return this.status();
  }
  async fail(code, generation) {
    if (generation !== this.generation) return;
    this.generation++;
    clearTimeout(this.timer); this.busy = false; const browser = this.browser; this.browser = null;
    await browser?.close().catch(() => {});
    if (this.generation !== generation + 1) return;
    const safeCode = Object.hasOwn(REVIEW_ERRORS, code) ? code : 'REVIEW_FAILED';
    this.stage('failed', { code: safeCode, message: REVIEW_ERRORS[safeCode] });
    await this.log('error', 'card-review', '카드 자동입력 검토 중지', { code: safeCode }).catch?.(() => {});
  }
  async run(config, card, fixture, generation) {
    const browser = await this.launch({ executablePath: this.executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=ko-KR'] });
    if (generation !== this.generation) { await browser.close(); return; }
    this.browser = browser;
    const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1000, height: 900 }, deviceScaleFactor: 3, serviceWorkers: 'block', userAgent: chromiumUserAgent(browser), acceptDownloads: false });
    context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(20000);
    const guard = new ReviewGuard(); await guard.install(context);
    // Offline synthetic test intercepts every request. Never forwards a request.
    if (fixture) await fixture.install(context, guard);
    context.on('page', page => { page.on('dialog', dialog => dialog.dismiss().catch(() => {})); page.on('download', download => download.cancel().catch(() => {})); });
    const page = await context.newPage(); this.stage('order');
    await page.goto(campUrl(config, 'book.php', config.siteId), { waitUntil: 'domcontentloaded' });
    const form = page.locator('form.js-book');
    if (await form.count() !== 1) throw cardError('ORDER_MISMATCH');
    const room = [...catalog.values()].find(room => room.siteId === config.siteId);
    if (!room || (config.roomName && room.name !== config.roomName)) throw cardError('ORDER_MISMATCH');
    const matched = await form.evaluate((element, input) => {
      const value = name => element.querySelector(`[name="${name}"]`)?.value;
      const action = new URL(element.action), amount = [...element.innerText.matchAll(/총\s*(?:금액\s*)?([\d,]+)\s*원/g)].map(match => Number(match[1].replaceAll(',', '')));
      return action.origin === 'https://www.swimozicamp.com' && action.pathname === '/camp/book.php' && element.method.toLowerCase() === 'post' && Boolean(value('_csrf')) && value('site') === String(input.siteId) && value('checkin') === input.startDate && value('checkout') === input.checkout && value('adults') === String(input.adults) && value('children') === '0' && value('infants') === '0' && element.querySelector('.sum-title')?.textContent?.replace(/\s+/g,'') === input.displayName.replace(/\s+/g,'') && amount.length > 0 && amount.every(value => value === input.amount);
    }, { ...config, profile: undefined, checkout: checkoutDate(config.startDate, config.nights), displayName: room.displayName });
    if (!matched) throw cardError('ORDER_MISMATCH');
    await form.locator('[name="name"]').fill(config.profile.reserverName);
    await form.locator('[name="phone"]').fill(config.profile.phone);
    await form.locator('[name="pay_method"][value="card"]').check();
    await form.locator('[name="agree_refund"]').check();
    this.stage('pg');
    // Exactly one merchant order submission. Never native submit fallback/retry.
    await form.locator('button[type="submit"]').click();
    const frameElement = page.locator('iframe[src^="https://stdpay.inicis.com/"]');
    await frameElement.waitFor({ state: 'attached' });
    const pg = await frameElement.elementHandle().then(handle => handle.contentFrame());
    if (!pg || new URL(pg.url()).origin !== 'https://stdpay.inicis.com') throw cardError('ORDER_MISMATCH');
    for (const id of ['inputChk7', 'inputChk3', 'inputChk4']) await pg.locator('#' + id).check();
    await pg.getByRole('link', { name: '삼성카드', exact: true }).click();
    const popupPromise = page.waitForEvent('popup');
    await pg.locator('#CardBtn').click(); const issuer = await popupPromise;
    await issuer.waitForLoadState('domcontentloaded'); assertSamsungPage(issuer, '400');
    await issuer.getByRole('button', { name: /다른결제/ }).click();
    await issuer.getByRole('button', { name: /일반 결제 카드번호로 결제/ }).click();
    await issuer.waitForURL(url => samsungStep(url.href) === '300');
    assertSamsungPage(issuer, '300');
    const summary = await issuer.locator('body').innerText();
    if (!summary.includes('쉼오지캠프') || !summary.includes(config.amount.toLocaleString('en-US') + '원')) throw cardError('ORDER_MISMATCH');
    this.stage('card'); await fillKeypad(issuer, issuer.getByRole('textbox', { name: '카드 번호', exact: true }), card.cardNumber, { ocr: this.ocr });
    this.stage('cvc'); await fillKeypad(issuer, issuer.getByRole('textbox', { name: 'CVC번호', exact: true }), card.cvc, { ocr: this.ocr });
    const next = issuer.getByRole('button', { name: '다음', exact: true });
    if (!await next.isEnabled()) throw cardError('KEYPAD_INPUT_UNVERIFIED');
    await next.click(); await issuer.waitForURL(url => samsungStep(url.href) === '301'); assertSamsungPage(issuer, '301');
    this.stage('password');
    const password = issuer.getByPlaceholder('숫자 6자리 입력', { exact: true });
    // Load and identify the keyboard, then block ALL network BEFORE entering a password.
    await fillKeypad(issuer, password, card.password, { ocr: this.ocr, beforeTyping: () => guard.stopNetwork(context) });
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
