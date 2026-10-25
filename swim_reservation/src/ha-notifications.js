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

export async function notificationService(optionsPath = '/data/options.json') {
  try {
    const options = JSON.parse(await readFile(optionsPath, 'utf8'));
    return options.error_notify_service ?? 'mobile_app_sm_s938n';
  } catch (error) {
    if (error.code === 'ENOENT') return 'mobile_app_sm_s938n';
    throw error;
  }
}
