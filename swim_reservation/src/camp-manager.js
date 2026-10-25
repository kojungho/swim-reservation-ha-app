import { ReservationManager as LegacyManager } from './reservation-manager.js';
import { CAMP_ROOT, catalog } from './camp-site.js';
import { readCampReservations, readCampLookupSelections } from './camp-records.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { maskedProfile, operationTrace, diagnosticError } from './camp-trace.js';

export function reservationCheckUrl() { return `${CAMP_ROOT}lookup.php`; }
export class ReservationManager extends LegacyManager {
  async cancel() { throw new Error('새 사이트에는 확인된 온라인 취소 기능이 없습니다. 공식 안내에 따라 캠핑장에 연락해 주세요.'); }
  async list(profile, { profileIndex } = {}) {
    const trace = operationTrace(this.log, { profile: maskedProfile(profile), ...(Number.isInteger(profileIndex) ? { profileIndex } : {}) });
    try { return await trace.step('lookup-session', () => this.withPage(async page => {
      const responseError = response => {
        if (response.status() >= 400 && response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
          trace.emit(trace.currentStep, 'http', { httpStatus: response.status(), method: response.request().method() });
        }
      };
      page.on('response', responseError);
      try { return await this.load(page, profile, trace); }
      finally { page.off('response', responseError); }
    })); }
    finally { await trace.flush(); }
  }
  async load(page, profile, trace = operationTrace(this.log, { profile: maskedProfile(profile) })) {
    const fail = message => diagnosticError('LOOKUP_VALIDATION_FAILED', message);
    const responseCheck = (response, step, metadata = {}) => {
      trace.emit(step, 'http', { ...metadata, httpStatus: response?.status?.() || null, method: step === 'lookup-open' ? 'GET' : 'POST' });
      if (!response?.ok()) throw diagnosticError('LOOKUP_HTTP_ERROR', `예약확인 HTTP ${response?.status?.() || '응답 없음'}입니다. 0건으로 판단하지 않습니다.`, { httpStatus: response?.status?.() || null });
    };
    await trace.step('lookup-open', async () => {
    const response = await page.goto(reservationCheckUrl(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    responseCheck(response, 'lookup-open');
    if (new URL(page.url()).origin !== new URL(CAMP_ROOT).origin || new URL(page.url()).pathname !== '/camp/lookup.php') throw fail('예약확인 주소가 예상과 다릅니다. 개인정보를 입력하지 않습니다.');
    });
    const form = page.locator('form.lookup-form');
    await trace.step('lookup-form-verify', async () => {
    if (await form.count() !== 1) throw fail('새 예약확인 입력 화면을 확인하지 못했습니다.');
    const checks = await form.evaluate(element => {
      const action = new URL(element.action);
      return { actionMatched: action.origin === location.origin && action.pathname === '/camp/lookup.php', methodMatched: element.method.toLowerCase() === 'post', csrfPresent: Boolean(element.querySelector('[name="_csrf"]')?.value) };
    });
    trace.emit('lookup-form-verify', 'checks', { checks });
    if (!Object.values(checks).every(Boolean)) throw diagnosticError('LOOKUP_FORM_MISMATCH', '예약확인 입력 화면의 보안 정보 또는 전송 주소가 다릅니다. 개인정보를 전송하지 않습니다.', checks);
    });
    await trace.step('lookup-fill', async () => {
    await form.locator('[name="name"]').fill(profile.reserverName);
    await form.locator('[name="phone"]').fill(profile.phone.replace(/\D/g, ''));
    });
    await trace.step('lookup-submit', async () => {
    const [result] = await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }), form.locator('button[type="submit"]').click()]);
    responseCheck(result, 'lookup-submit');
    const finalUrl = new URL(page.url());
    if (finalUrl.origin !== new URL(CAMP_ROOT).origin || finalUrl.pathname !== '/camp/lookup.php') throw fail('예약확인 결과 주소가 예상과 다릅니다. 0건으로 판단하지 않습니다.');
    });
    const parsed = await trace.step('lookup-result-parse', () => page.evaluate(readCampReservations, { expectedName: profile.reserverName, rooms: [...catalog.values()] }));
    if (['detail', 'list', 'empty'].includes(parsed.kind)) {
      trace.emit('lookup-summary', 'complete', { resultKind: parsed.kind, count: parsed.rows.length });
      return parsed.rows;
    }
    const selections = await trace.step('lookup-selections-verify', async () => {
      const result = await page.evaluate(readCampLookupSelections, { expectedName: profile.reserverName, expectedPhone: profile.phone });
      if (!result) throw fail('조회 응답의 예약번호·예약자·사이트·기간·금액·상태를 일치 확인하지 못했습니다. 공식 사이트에서 확인해 주세요. 0건으로 판단하지 않습니다.');
      trace.emit('lookup-selections-verify', 'checks', { detailCount: result.length });
      return result;
    });
    if (selections) {
      const rows = [];
      for (const [index, selection] of selections.entries()) {
        const metadata = { detailIndex: index };
        if (index) await trace.step('lookup-detail-wait', () => sleep(1000), metadata);
        // Only the original, validated detail-selection POST. No booking, payment,
        // cancellation, token guessing, redirects or automatic retries.
        const detail = await trace.step('lookup-detail-fetch', async () => {
          const response = await page.request.post(reservationCheckUrl(), { form: selection.fields, timeout: 20_000, maxRedirects: 0, maxRetries: 0 });
          responseCheck(response, 'lookup-detail-fetch', metadata);
          return response;
        }, metadata);
        const result = await trace.step('lookup-detail-verify', async () => {
        const address = new URL(detail.url());
        if (address.origin !== new URL(CAMP_ROOT).origin || address.pathname !== '/camp/lookup.php') throw fail('예약 상세 조회 주소가 예상과 다릅니다.');
        if (!/text\/html/i.test(detail.headers()['content-type'] || '') || Number(detail.headers()['content-length'] || 0) > 1048576) throw fail('정상적인 예약 상세 HTML 응답이 아닙니다.');
        const html = await detail.text();
        if (html.length > 1048576) throw fail('예약 상세 응답이 너무 커서 분석하지 않습니다.');
        const result = await page.evaluate(readCampReservations, { expectedName: profile.reserverName, rooms: [...catalog.values()], html });
        const checks = { detailRecognized: result.kind === 'detail', oneRow: result.rows.length === 1,
          idMatched: !selection.id || result.rows[0]?.id === selection.id, unique: !rows.some(row => row.id === result.rows[0]?.id) };
        trace.emit('lookup-detail-verify', 'checks', { ...metadata, checks });
        if (!Object.values(checks).every(Boolean)) throw diagnosticError('LOOKUP_DETAIL_MISMATCH', '예약 상세의 식별값 또는 예약 정보를 일치 확인하지 못했습니다. 일부 결과를 전체 조회로 표시하지 않습니다.', checks);
        return result;
        }, metadata);
        rows.push(result.rows[0]);
      }
      trace.emit('lookup-summary', 'complete', { resultKind: 'details', count: rows.length });
      return rows;
    }
    throw fail('조회 응답의 예약번호·예약자·사이트·기간·금액·상태를 일치 확인하지 못했습니다. 공식 사이트에서 확인해 주세요. 0건으로 판단하지 않습니다.');
  }
}
