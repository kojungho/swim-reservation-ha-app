import { readFile } from 'node:fs/promises';

// Only final booking outcomes and watch failures trigger push notifications.
// Do not send profile data, raw exception messages, URLs or response bodies.
export class HaNotifications {
  constructor({ token = process.env.SUPERVISOR_TOKEN, service = 'mobile_app_sm_s938n', fetchImpl = fetch, now = Date.now, onError = () => {} } = {}) {
    this.token = token;
    this.service = service;
    this.fetch = fetchImpl;
    this.now = now;
    this.onError = onError;
    this.sent = new Map();
    this.pending = new Set();
  }

  observe(entry) {
    const d = entry.details || {};
    const id = String(d.planId || 'default');
    if (entry.event === 'preflight-result') {
      if (d.kind === 'daily' && d.state === 'passed') return; // Daily success stays in the log; only issues push.
      const result = preflightNotification(d);
      const key = `preflight:${id}:${d.key || ''}`;
      if (!result || !this.token || !this.service || this.sent.has(key) || this.pending.size >= 50) return;
      this.sent.set(key, this.now());
      if (this.sent.size > 1000) this.sent.delete(this.sent.keys().next().value);
      const task = this.send(result.title, result.message, `preflight-${id}`)
        .catch(() => { this.sent.delete(key); try { this.onError(); } catch {} })
        .finally(() => this.pending.delete(task));
      this.pending.add(task);
      return;
    }
    if (entry.event === 'status' && ['armed', 'starting-now', 'starting', 'complete'].includes(d.stage)) {
      this.sent.delete(`${id}:waiting`);
      this.sent.delete(`${id}:failed`);
    }
    const failed = entry.event === 'status' && (d.state === 'failed' || d.stage === 'watch-read-error');
    if (!failed && !(entry.level === 'error' && entry.event === 'plan-watch')) return;
    if (!this.token || !this.service || this.pending.size >= 50) return;
    const waiting = d.stage === 'watch-read-error' || entry.event === 'plan-watch';
    const key = `${id}:${waiting ? 'waiting' : 'failed'}`;
    const last = this.sent.get(key);
    if (last !== undefined && this.now() - last < 300_000) return;
    this.sent.set(key, this.now());
    if (this.sent.size > 1000) this.sent.delete(this.sent.keys().next().value);
    const message = waiting
      ? '취소 대기 중 조회 오류가 발생했습니다. 애드온 실행 기록과 대기 상태를 확인해 주세요.'
      : '예약 실행에 실패했거나 결과 확인이 필요합니다. 중복 예약 방지를 위해 실제 예약 내역을 먼저 확인해 주세요.';
    const task = this.send('쉼오지 예약 · 오류 알림', message, id)
      .catch(() => { try { this.onError(); } catch { /* never affect booking */ } })
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  async send(title, message, id = 'test') {
    if (!this.token || !/^mobile_app_[a-z0-9_]+$/.test(this.service)) throw new Error('HA notification configuration unavailable');
    const response = await this.fetch(`http://supervisor/core/api/services/notify/${this.service}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message, data: {
        tag: `swim-error-${id}`, channel: '쉼오지 예약 오류', importance: 'high', priority: 'high', ttl: 0,
        clickAction: '/hassio/ingress/76980dac_swim_reservation'
      } }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('HA notification request failed');
    await response.body?.cancel();
  }
}

export function preflightNotification(d) {
  if (d.kind === 'daily') {
    const original = preflightNotification({ ...d, kind: 'scheduled' });
    if (!original) return null;
    return { title: original.title.replace('사전 점검', '일일 점검'), message: original.message.replace('기존 예약 대기는 유지됩니다.', '예약 일정은 변경하지 않았습니다.') };
  }
  const suffix = ' 최종 제출하지 않았으며 기존 예약 대기는 유지됩니다. 알림을 눌러 실행 기록을 확인하세요.';
  if (d.state === 'passed') return { title: '쉼오지 예약 · 사전 점검 통과', message: '열린 날짜의 1박 빈자리로 예약자 입력·무통장입금·필수 약관을 확인했습니다. 실제 예약 접수 여부는 점검 대상이 아닙니다.' + suffix };
  if (d.state === 'unavailable') return { title: '쉼오지 예약 · 사전 점검 미완료', message: '점검한 날짜에 예약 가능한 빈자리가 없어 입력 단계까지 확인하지 못했습니다.' + suffix };
  if (!['failed', 'interrupted'].includes(d.state)) return null;
  const steps = { 'calendar-fetch': '잔여 자리 달력 조회', 'calendar-parse': '달력 응답 해석', 'calendar-verify': '달력 잔여 자리 대조', 'profile-read': '점검 설정 읽기', 'room-lookup': '객실 조회', 'browser-ready': '브라우저 연결', 'form-detect': '예약 폼 탐색', 'form-ready': '예약 폼 준비', 'form-verify': '기간·사이트 대조', 'personal-fill': '예약자 입력·결제·약관', 'pre-submit-verify': '입력값·결제·약관 최종 확인' };
  const causes = { CATALOG_REQUESTED_SITE_MISSING: '대기 일정에 선택한 사이트명의 연결을 공식 목록에서 확인하지 못했습니다.', CATALOG_MISMATCH: '사이트 이름·번호·URL의 일일 대조를 완료하지 못했습니다.', CATALOG_CHANGED_DURING_CHECK: '점검 도중 사이트 목록이 바뀌어 이전 정상 목록을 유지했습니다.', PAYMENT_METHOD_UNRECOGNIZED: '무통장입금 항목을 확인하지 못했습니다.', FORM_FIELDS_UNRECOGNIZED: '입력 항목 또는 필수 약관을 확인하지 못했습니다.', SITE_RATE_LIMIT: '사이트에서 요청을 제한했습니다.', SITE_HTTP_ERROR: '사이트가 정상 응답하지 않았습니다.', SITE_CONNECTION: '사이트에 연결하지 못했습니다.', PREFLIGHT_INTERRUPTED: '점검이 중단되었거나 제한 시간을 넘었습니다.', PREFLIGHT_WRITE_BLOCKED: '입력 중 전송 시도가 있어 차단했습니다.' };
  return { title: '쉼오지 예약 · 사전 점검 확인 필요', message: `${steps[d.step] || '예약 양식 점검'}: ${causes[d.code] || '정상 진행을 확인하지 못했습니다. 상세 로그 확인이 필요합니다.'}` + suffix };
}

export async function notificationService(optionsPath = '/data/options.json') {
  try {
    const options = JSON.parse(await readFile(optionsPath, 'utf8'));
    return options.error_notify_service ?? 'mobile_app_sm_s938n';
  } catch (error) {
    if (error.code === 'ENOENT') return 'mobile_app_sm_s938n';
    throw error;
  }
}
