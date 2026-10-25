import { CAMP_ROOT, campUrl, catalog } from './camp-site.js';
import { bookingOpenIso } from './config.js';

export function monthlyUrl(month) {
  if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(String(month))) throw new Error('조회할 월을 확인해 주세요.');
  return `${CAMP_ROOT}api.php?a=cal&ym=${month}`;
}
export function calendarDayUrl(date) { return campUrl({ startDate: date, nights: 1 }); }
export async function inspectCalendarDay(engine, { calendarDate }) {
  return { date: calendarDate, rooms: await engine.inspect({ startDate: calendarDate, nights: 1 }), sourceUrl: calendarDayUrl(calendarDate), capturedAt: Date.now() };
}
export async function inspectMonth(engine, { month, knownRooms = [] }) {
  const sourceUrl = monthlyUrl(month);
  const response = await engine.traceStep('calendar-fetch', async () => {
    const response = await engine.page.request.get(sourceUrl, { timeout: 20_000 });
    engine.recordTrace('calendar-fetch', 'http', { httpStatus: response.status(), method: 'GET' });
    if (!response.ok()) throw Object.assign(new Error(`달력 조회 HTTP ${response.status()}입니다. 자동 재시도하지 않습니다.`), { code: 'CALENDAR_HTTP_ERROR', safeToLog: true });
    return response;
  });
  const result = await engine.traceStep('calendar-parse', () => response.json());
  return engine.traceStep('calendar-verify', async () => parseCampCalendar(result, month, knownRooms, sourceUrl));
}
export function parseCampCalendar(result, month, knownRooms = [], sourceUrl = monthlyUrl(month)) {
  if (result.ok !== true || result.ym !== month || !/^\d{4}-\d{2}-\d{2}$/.test(result.open) || !result.days || typeof result.days !== 'object') throw new Error('정상적인 달력 응답이 아닙니다.');
  const roomNames = [...new Set([...catalog.keys(), ...knownRooms])];
  const [year, number] = month.split('-').map(Number);
  const days = Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    const count = result.days[date];
    const beforeOpen = date > result.open;
    return { date, beforeOpen, availableCount: !beforeOpen && Number.isInteger(count) && count >= 0 ? count : null, queryState: 'done', rooms: roomNames.map(name => ({ name, status: 'unknown' })) };
  });
  return { siteVersion: 'swimozicamp-v1', month, opensAt: bookingOpenIso(`${month}-01`), beforeOpen: `${month}-01` > result.open, openThrough: result.open, countsOnly: true, roomNames, days, provided: true, sourceUrl, capturedAt: Date.now(), message: '새 달력은 날짜별 남은 사이트 수만 제공합니다. 개별 사이트·연속 박수는 빈자리 조회로 확인하세요. 오픈 전 수치는 예약 가능으로 표시하지 않습니다.' };
}
