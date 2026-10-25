import { ReservationManager as LegacyManager } from './reservation-manager.js';
import { CAMP_ROOT, catalog } from './camp-site.js';
import { readCampReservations, readCampLookupSelections } from './camp-records.js';
import { setTimeout as sleep } from 'node:timers/promises';

export function reservationCheckUrl() { return `${CAMP_ROOT}lookup.php`; }
export class ReservationManager extends LegacyManager {
  async cancel() { throw new Error('새 사이트에는 확인된 온라인 취소 기능이 없습니다. 공식 안내에 따라 캠핑장에 연락해 주세요.'); }
  async list(profile) {
    try { return await super.list(profile); }
    catch (error) {
      // Browser fill/navigation call logs may include the name, phone or private URL.
      if (error.safeToLog) throw error;
      throw new Error('예약확인 화면을 처리하지 못했습니다. 공식 사이트에서 확인해 주세요. 개인정보·응답 원문은 기록하지 않습니다.');
    }
  }
  async load(page, profile) {
    const fail = message => Object.assign(new Error(message), { safeToLog: true });
    const response = await page.goto(reservationCheckUrl(), { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (!response?.ok()) throw fail(`예약확인 HTTP ${response?.status() || '응답 없음'}입니다. 0건으로 판단하지 않습니다.`);
    if (new URL(page.url()).origin !== new URL(CAMP_ROOT).origin || new URL(page.url()).pathname !== '/camp/lookup.php') throw fail('예약확인 주소가 예상과 다릅니다. 개인정보를 입력하지 않습니다.');
    const form = page.locator('form.lookup-form');
    if (await form.count() !== 1) throw fail('새 예약확인 입력 화면을 확인하지 못했습니다.');
    const valid = await form.evaluate(element => {
      const action = new URL(element.action);
      return action.origin === location.origin && action.pathname === '/camp/lookup.php' && element.method.toLowerCase() === 'post' && Boolean(element.querySelector('[name="_csrf"]')?.value);
    });
    if (!valid) throw fail('예약확인 입력 화면의 보안 정보 또는 전송 주소가 다릅니다. 개인정보를 전송하지 않습니다.');
    await form.locator('[name="name"]').fill(profile.reserverName);
    await form.locator('[name="phone"]').fill(profile.phone.replace(/\D/g, ''));
    const [result] = await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20_000 }), form.locator('button[type="submit"]').click()]);
    if (!result?.ok()) throw fail(`예약확인 HTTP ${result?.status() || '응답 없음'}입니다. 0건으로 판단하지 않습니다.`);
    const finalUrl = new URL(page.url());
    if (finalUrl.origin !== new URL(CAMP_ROOT).origin || finalUrl.pathname !== '/camp/lookup.php') throw fail('예약확인 결과 주소가 예상과 다릅니다. 0건으로 판단하지 않습니다.');
    const parsed = await page.evaluate(readCampReservations, { expectedName: profile.reserverName, rooms: [...catalog.values()] });
    if (['detail', 'list', 'empty'].includes(parsed.kind)) return parsed.rows;
    const selections = await page.evaluate(readCampLookupSelections, { expectedName: profile.reserverName, expectedPhone: profile.phone });
    if (selections) {
      const rows = [];
      for (const [index, selection] of selections.entries()) {
        if (index) await sleep(1000);
        // Only the original, validated detail-selection POST. No booking, payment,
        // cancellation, token guessing, redirects or automatic retries.
        const detail = await page.request.post(reservationCheckUrl(), { form: selection.fields, timeout: 20_000, maxRedirects: 0, maxRetries: 0 });
        if (!detail.ok()) throw fail(`예약 상세 조회 HTTP ${detail.status()}입니다. 추가 조회나 재시도하지 않습니다.`);
        const address = new URL(detail.url());
        if (address.origin !== new URL(CAMP_ROOT).origin || address.pathname !== '/camp/lookup.php') throw fail('예약 상세 조회 주소가 예상과 다릅니다.');
        if (!/text\/html/i.test(detail.headers()['content-type'] || '') || Number(detail.headers()['content-length'] || 0) > 1048576) throw fail('정상적인 예약 상세 HTML 응답이 아닙니다.');
        const html = await detail.text();
        if (html.length > 1048576) throw fail('예약 상세 응답이 너무 커서 분석하지 않습니다.');
        const result = await page.evaluate(readCampReservations, { expectedName: profile.reserverName, rooms: [...catalog.values()], html });
        if (result.kind !== 'detail' || result.rows.length !== 1 || (selection.id && result.rows[0].id !== selection.id) || rows.some(row => row.id === result.rows[0].id)) throw fail('예약 상세의 식별값 또는 예약 정보를 일치 확인하지 못했습니다. 일부 결과를 전체 조회로 표시하지 않습니다.');
        rows.push(result.rows[0]);
      }
      return rows;
    }
    throw fail('조회 응답의 예약번호·예약자·사이트·기간·금액·상태를 일치 확인하지 못했습니다. 공식 사이트에서 확인해 주세요. 0건으로 판단하지 않습니다.');
  }
}
