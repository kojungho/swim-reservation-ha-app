import { ReservationEngine as LegacyEngine } from './reservation-engine.js';
import { getProfiles, triggerEpoch, bookingOpenIso } from './config.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { CAMP_ROOT, campUrl, catalog, checkoutDate, mergeListing, readCampListing, persistCatalog } from './camp-site.js';
import { reservationErrorDetails } from './reservation-errors.js';
import { readCampReservations } from './camp-records.js';
import { fillCampForm } from './camp-form.js';
import { maskedProfile, safeCampError } from './camp-trace.js';

const fail = (code, message) => Object.assign(new Error(message), { code, safeToLog: true });
export class ReservationEngine extends LegacyEngine {
  supportsPrewarm = false;
  async traceStep(step, action) {
    return super.traceStep(step, async () => {
      try { return await action(); }
      catch (error) {
        // Playwright call logs can include filled names/phone numbers. Never retain them.
        throw safeCampError(error, 'CAMP_ENGINE_ERROR');
      }
    });
  }
  async prepare() { throw fail('PREWARM_UNSUPPORTED', '새 사이트는 오픈 전 사전 입력을 지원하지 않습니다. 실행 시각에 입력합니다.'); }
  async ensurePage() {
    if (this.page) return;
    await super.ensurePage();
    this.page.removeAllListeners('dialog');
    this.page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  }
  async navigate(url) {
    this.navigationFailure = null;
    let response;
    try { response = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }); }
    catch (error) {
      if (this.navigationFailure?.status === 429) throw fail('SITE_RATE_LIMIT', '사이트 요청 제한(HTTP 429)입니다. 자동 재시도하지 않습니다.');
      throw Object.assign(fail('SITE_CONNECTION', '사이트 연결 결과를 확인할 수 없습니다.'), { failureKind: safeCampError(error).failureKind });
    }
    if (!response?.ok()) throw fail(response?.status() === 429 ? 'SITE_RATE_LIMIT' : 'SITE_HTTP_ERROR', `사이트 HTTP ${response?.status() || '응답 없음'}입니다. 자동 재시도하지 않습니다.`);
    if (new URL(this.page.url()).origin !== new URL(CAMP_ROOT).origin) throw fail('SITE_REDIRECT', '예상하지 못한 사이트로 이동했습니다.');
    return response;
  }
  async inspect(config) {
    await this.traceStep('browser-ready', () => this.ensurePage());
    if (triggerEpoch(bookingOpenIso(config.startDate)) > Date.now()) return [...catalog.values()].map(room => ({ ...room, available: false, status: 'unknown', serverProvided: false, options: [] }));
    await this.traceStep('room-lookup', () => this.navigate(campUrl(config)));
    const rooms = await this.traceStep('listing-verify', async () => mergeListing(await this.page.evaluate(readCampListing), config));
    this.recordTrace('listing-verify', 'checks', { siteCount: rooms.length, availableCount: rooms.filter(room => room.available).length });
    await this.traceStep('catalog-save', () => persistCatalog());
    return rooms;
  }
  async runSingle(config, { allowFallback = true, beforeSubmit } = {}) {
    let submitted = false;
    this.traceContext.profile = maskedProfile(getProfiles(config)[0]);
    try {
      if ((config.paymentMethod || 'bank') !== 'bank') throw fail('MANUAL_PAYMENT_REQUIRED', '카드·계좌이체는 공식 사이트에서 직접 진행해 주세요. 현재 공식 안내는 무통장입금만 지원합니다.');
      await this.traceStep('browser-ready', () => this.ensurePage());
      const candidates = config.roomPriority.filter(room => room.enabled);
      if (!candidates.length) throw fail('NO_AVAILABLE_ROOM', '예약할 사이트를 선택해 주세요.');
      for (const candidate of candidates) {
        const room = catalog.get(candidate.name);
        await this.traceStep('site-resolve', async () => {
          if (!room) throw fail('UNKNOWN_SITE', '사이트 번호를 확인하지 못했습니다. 빈자리 목록을 먼저 조회해 주세요.');
        });
        this.selectedRoom = room.name;
        await this.store.updateStatus({ state: 'running', selectedRoom: room.name, stage: 'room-lookup', message: `${room.name}: 예약 정보 화면을 불러옵니다.` });
        // Only a short opening-time readiness window, GET only. An ordinary pre-open
        // visit, HTTP error, unknown layout or any submitted request is never retried.
        for (let attempt = 0; attempt < 3; attempt++) {
          await this.traceStep('room-lookup', () => this.navigate(campUrl(config, 'book.php', room.siteId)));
          if (await this.traceStep('form-detect', () => this.page.locator('form.js-book').count())) break;
          const notice = await this.page.locator('.msg-box').innerText().catch(() => '');
          const elapsed = Date.now() - triggerEpoch(config.triggerAt);
          if (attempt === 2 || elapsed < 0 || elapsed > 10_000 || !/체크인까지|오픈|예약.*시작|아직/.test(notice)) break;
          await this.traceStep('opening-wait', () => sleep(2000));
        }
        const form = this.page.locator('form.js-book');
        const available = await this.traceStep('form-ready', async () => {
        if (!await form.count()) {
          const message = await this.page.locator('.msg-box').innerText().catch(() => '');
          if (/체크인까지|오픈|예약.*시작|아직/.test(message)) throw fail('BOOKING_NOT_OPEN', '공식 사이트가 예약 오픈 전으로 안내합니다. 사전 입력·제출하지 않습니다.');
          if (/예약.*(불가|마감)|예약할 수 없|선택.*(없|불가)/.test(message) && allowFallback) return false;
          throw fail('FORM_UNRECOGNIZED', '예약 정보 화면이 제공되지 않습니다. 제한 안내 또는 예약 가능 여부를 공식 사이트에서 확인해 주세요.');
        }
        return true;
        });
        if (!available) { this.recordTrace('site-unavailable', 'complete', { fallbackAllowed: true }); continue; }
        await this.traceStep('form-verify', () => this.assertForm(config, room));
        await this.traceStep('personal-fill', async () => {
          const profile = getProfiles(config)[0];
          const result = await form.evaluate(fillCampForm, { fields: {
            name: profile.reserverName, phone: profile.phone.replace(/\D/g, ''), depositor: profile.depositorName || profile.reserverName,
            request: config.request || '', arrive_time: config.arrivalTime || ''
          } });
          for (const step of result.steps || []) {
            this.recordTrace(step.step, 'start', { execution: 'single-browser-batch' });
            this.recordTrace(step.step, step.outcome, { elapsedMs: step.elapsedMs, checks: step.checks, invalidFields: step.step === result.failedStep ? result.invalidFields || [] : [] });
          }
          if (!result.ok) throw Object.assign(fail(result.code, '예약자 정보·필수 약관을 일괄 입력한 결과를 검증하지 못했습니다. 제출하지 않습니다.'), { substep: result.failedStep });
        });
        // No automatic POST retry, including timeouts, 403/429 and unknown receipts.
        const submit = async () => {
          if (beforeSubmit) await this.traceStep('deadline-verify', () => beforeSubmit());
          await this.traceStep('pre-submit-verify', () => this.assertForm(config, room, { verifyInputs: true }));
          await this.traceStep('consent-verify', async () => {
            if (config.autoFinalSubmit === false) throw fail('FINAL_CONSENT_REQUIRED', '최종 자동 제출 동의를 확인해 주세요.');
          });
          submitted = true;
          await this.traceStep('final-submit', async () => {
            const navigation = this.page.waitForURL(url => url.origin === new URL(CAMP_ROOT).origin && url.pathname === '/camp/done.php', { waitUntil: 'domcontentloaded', timeout: 20_000 });
            this.recordTrace('submit-click', 'start');
            const click = form.locator('button.js-pay').click().then(() => this.recordTrace('submit-click', 'complete'), error => {
              this.recordTrace('submit-click', 'error', { error: reservationErrorDetails(safeCampError(error)) });
              throw error;
            });
            try { await Promise.all([navigation, click]); }
            catch {
              if (this.navigationFailure?.status === 429) throw fail('SITE_RATE_LIMIT', '사이트 요청 제한(HTTP 429)입니다. 예약 내역을 먼저 확인하세요. 재제출하지 않습니다.');
              throw fail('RESULT_UNCERTAIN', '제출 결과 확인이 필요합니다. 예약 내역을 먼저 확인하세요. 재제출하지 않습니다.');
            }
          });
        };
        if (this.finalSubmitQueue) await this.finalSubmitQueue.run(submit, delayMs => this.recordTrace('final-delay', 'start', { delayMs }));
        else await submit();
        await this.traceStep('receipt-verify', () => this.verifyCompletion(config));
        await this.store.updateStatus({ state: 'success', stage: 'complete', selectedRoom: room.name, message: '예약 신청 완료 · 입금 대기입니다. 공식 안내의 기한 안에 직접 입금해 주세요.' });
        return { room: room.name, paymentStatus: 'pending' };
      }
      throw fail('NO_AVAILABLE_ROOM', '선택한 우선순위 사이트가 예약 불가입니다.');
    } catch (error) {
      await this.rateLimitDiagnostic;
      error = safeCampError(error, 'CAMP_ENGINE_ERROR');
      error.details = reservationErrorDetails(error, { submitted, room: this.selectedRoom, stage: this.currentStep, navigation: this.navigationFailure });
      error.diagnostics = { ...error.details, profile: this.traceContext.profile, attemptId: this.traceContext.attemptId };
      if (!error.step) this.recordTrace(this.currentStep, 'error', { submitted, error: reservationErrorDetails(error) });
      throw error;
    }
  }
  async assertForm(config, room, { verifyInputs = false } = {}) {
    const expected = { site: String(room.siteId), checkin: config.startDate, checkout: checkoutDate(config.startDate, config.nights), adults: String(config.adults || 2), children: '0', infants: '0' };
    const checks = await this.page.locator('form.js-book').evaluate((form, { fields, verifyInputs }) => {
      const action = new URL(form.action);
      const checks = { actionMatched: action.origin === location.origin && action.pathname === '/camp/book.php', methodMatched: form.method.toLowerCase() === 'post',
        csrfPresent: Boolean(form.querySelector('[name="_csrf"]')?.value),
        ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, form.querySelector(`[name="${key}"]`)?.value === value])) };
      if (verifyInputs) {
        const terms = [...form.querySelectorAll('input.js-agree[data-required="1"]')];
        checks.requiredTermsChecked = terms.length > 0 && terms.every(term => term.type === 'checkbox' && term.checked && !term.matches(':disabled'));
        checks.bankSelected = form.querySelector('input[name="pay_method"][value="bank"]')?.checked === true;
        checks.nativeValid = form.checkValidity();
      }
      return checks;
    }, { fields: expected, verifyInputs });
    const title = await this.page.locator('.summary-card .sum-title').textContent().catch(() => '');
    checks.siteNameMatched = title.replace(/\s/g, '') === room.displayName;
    this.recordTrace(this.currentStep, 'checks', { checks });
    if (!Object.values(checks).every(Boolean)) throw Object.assign(fail('FORM_MISMATCH', '예약 정보의 사이트·날짜·인원을 일치 확인하지 못했습니다. 제출하지 않습니다.'), { checks });
  }
  async verifyCompletion(config) {
    const profile = getProfiles(config)[0];
    const parsed = await this.page.evaluate(readCampReservations, { expectedName: profile.reserverName, rooms: [...catalog.values()] });
    const row = parsed.rows[0];
    const checks = { detailRecognized: parsed.kind === 'detail', submissionComplete: Boolean(parsed.submissionComplete), paymentPending: row?.paymentStatus === 'pending',
      roomMatched: row?.room === this.selectedRoom, checkinMatched: row?.stayDate === config.startDate, checkoutMatched: row?.checkout === checkoutDate(config.startDate, config.nights),
      nightsMatched: row?.nights === `${config.nights}박`, adultsMatched: row?.adults === Number(config.adults || 2) };
    this.recordTrace('receipt-verify', 'checks', { checks });
    if (!Object.values(checks).every(Boolean)) {
      throw Object.assign(fail('COMPLETION_UNVERIFIED', '예약 완료 화면의 예약번호·예약자·사이트·숙박일·입금대기를 일치 확인하지 못했습니다. 예약 조회로 확인해 주세요. 재제출하지 않습니다.'), { checks });
    }
  }
  async prepareMultiple(config) {
    await this.close();
    this.childSessions = config.roomPriority.filter(room => room.enabled).map(room => this.createChildSession(config, room.name));
    this.campSessions = [...this.childSessions];
    // Build isolated browser sessions only. Legacy engine's runMultiple then runs each new form at execution time.
  }
  async runMultiple(config, options) {
    try { return await super.runMultiple(config, options); }
    finally {
      await Promise.all((this.campSessions || []).map(session => session.engine.close()));
      this.campSessions = [];
    }
  }
}
