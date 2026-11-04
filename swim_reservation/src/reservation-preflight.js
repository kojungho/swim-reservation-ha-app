import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { bookingOpenIso, triggerEpoch, getProfiles } from './config.js';
import { validPersonName } from './person-name.js';
import { monthlyUrl, parseCampCalendar } from './camp-monthly.js';
import { checkDailyCatalog } from './camp-catalog-check.js';

const DAY = 86400000, OFFSET = 9 * 3600000;
const day = now => new Date(now + OFFSET).toISOString().slice(0, 10);
const at = (date, hour) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00+09:00`);
export function preflightDue(trigger) { return at(day(trigger - DAY), 10); }
export function preflightWindow(now) { return now >= at(day(now), 8) && now < at(day(now), 19); }
export function preflightKey(plan) { return createHash('sha256').update(JSON.stringify([plan.id, plan.config])).digest('hex'); }
export function dailyPreflightKey(now) { return createHash('sha256').update(`daily-catalog-v3:${day(now)}`).digest('hex'); }
export function dailyPreflightConfig(config, profiles = []) {
  const valid = p => validPersonName(p.reserverName) && /^01\d{8,9}$/.test(p.phone || '') && String(p.depositorName || '').length <= 50;
  const profile = [...profiles, ...getProfiles(config)].find(valid);
  return { ...config, startDate: '', nights: 1, adults: 2, request: '', arrivalTime: '', bookingMode: 'priority', paymentMethod: 'bank', autoFinalSubmit: false,
    profiles: [profile ? structuredClone(profile) : { reserverName: '점검예약자', phone: '01000000000', depositorName: '' }], preflightDaily: true,
    preflightProfileSource: profile ? 'saved' : 'sample' };
}
export function preflightDates(now) {
  return [1, 2, 7, 14, 21, 28, 35].map(offset => day(now + offset * DAY))
    .filter(date => triggerEpoch(bookingOpenIso(date)) <= now);
}
const problem = (code, step) => Object.assign(new Error(code), { code, step });

export async function dailyPreflightDates(engine, now, signal) {
  const current = day(now), dates = [];
  for (let offset = 0; offset < 3; offset++) {
    if (signal?.aborted) throw problem('PREFLIGHT_INTERRUPTED', 'calendar-fetch');
    const month = new Date(Date.UTC(Number(current.slice(0,4)), Number(current.slice(5,7)) - 1 + offset, 1)).toISOString().slice(0,7);
    if (triggerEpoch(bookingOpenIso(`${month}-01`)) > now) continue;
    const response = await engine.traceStep('calendar-fetch', () => engine.navigate(monthlyUrl(month)));
    const raw = await engine.traceStep('calendar-parse', () => response.json());
    const calendar = await engine.traceStep('calendar-verify', async () => parseCampCalendar(raw, month));
    dates.push(...calendar.days.filter(d => d.date > current && !d.beforeOpen && d.availableCount > 0).map(d => ({date:d.date,count:d.availableCount})));
  }
  return dates.sort((a,b)=>b.count-a.count||a.date.localeCompare(b.date)).slice(0,7).map(d=>d.date);
}

// Separate browser/store from the waiting reservation. The network guard blocks
// ALL mutations, even if site JavaScript submits unexpectedly during input.
export async function inspectReservationPreflight(engine, config, now, signal) {
  let mutationBlocked = false;
  const guard = async route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) { mutationBlocked = true; await route.abort(); }
    else await route.fallback();
  };
  const abort = () => { void engine.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw problem('PREFLIGHT_INTERRUPTED', 'browser-ready');
    await engine.ensurePage();
    if (signal?.aborted) throw problem('PREFLIGHT_INTERRUPTED', 'browser-ready');
    await engine.context.addInitScript(() => {
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('Preflight disables service workers'));
    });
    await engine.context.route('**/*', guard);
    let candidate;
    const dates = config.preflightDaily ? await dailyPreflightDates(engine, now, signal) : preflightDates(now);
    const catalogCheck = config.preflightDaily ? await checkDailyCatalog(engine, config, dates.length ? dates : preflightDates(now).slice(0,1), now, signal) : undefined;
    for (const startDate of dates) {
      if (startDate.slice(0, 7) === config.startDate.slice(0, 7)) continue;
      if (signal?.aborted) throw problem('PREFLIGHT_INTERRUPTED', 'room-lookup');
      const trial = { ...config, startDate, nights: 1, triggerAt: bookingOpenIso(startDate), bookingMode: 'priority' };
      const rooms = await engine.inspect(trial);
      const room = rooms.find(room => room.available === true && room.status === 'available');
      if (room) { candidate = { ...trial, roomPriority: [{ name: room.name, enabled: true }] }; break; }
    }
    if (!candidate) throw problem('PREFLIGHT_NO_VACANCY', 'room-lookup');
    for (const profile of getProfiles(config)) {
      if (signal?.aborted) throw problem('PREFLIGHT_INTERRUPTED', 'personal-fill');
      const result = await engine.runSingle({ ...candidate, profiles: [profile], multipleProfileIndex: 0 }, { checkOnly: true });
      if (mutationBlocked) throw problem('PREFLIGHT_WRITE_BLOCKED', 'pre-submit-verify');
      if (!result?.verified || result.submitted !== false) throw problem('PREFLIGHT_NOT_VERIFIED', 'pre-submit-verify');
    }
    return { checkin: candidate.startDate, nights: 1, site: candidate.roomPriority[0].name, profilesChecked: getProfiles(config).length, submitted: false, ...(catalogCheck ? {catalogCheck} : {}) };
  } finally {
    signal?.removeEventListener('abort', abort);
    await engine.close();
  }
}

// Journal one check per immutable waiting configuration. Restart, stop, edit and
// a failed check cannot start a booking or replace the real reservation status.
export class ReservationPreflight {
  constructor({ dataDir, list, engineFactory, log, now = Date.now, canCheck = () => true, inspect = inspectReservationPreflight, timeoutMs = 120000, dailyConfig = null }) {
    Object.assign(this, { list, engineFactory, log, now, canCheck, inspect, timeoutMs, dailyConfig });
    this.file = path.join(dataDir, 'reservation-preflight.json');
    this.entries = [];
    this.running = false;
    this.closed = false;
  }
  async init() {
    try { this.entries = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const entry of this.entries) if (entry.state === 'checking') { entry.state = 'interrupted'; entry.code = 'PREFLIGHT_INTERRUPTED'; }
    await this.persist();
  }
  async persist() {
    await writeFile(this.file + '.tmp', JSON.stringify(this.entries), { mode: 0o600 });
    await rename(this.file + '.tmp', this.file);
  }
  start() {
    this.timer = setInterval(() => { void this.tick().catch(() => this.log('error', 'preflight-system', '사전 점검 기록을 처리하지 못했습니다. 예약 대기 상태는 유지됩니다.')); }, 30000);
    this.timer.unref?.();
    void this.tick().catch(() => {});
  }
  async tick() {
    if (this.closed || this.running || !preflightWindow(this.now()) || !this.canCheck()) return;
    this.running = true;
    try {
      const plans = await this.list(), now = this.now();
      const interruptedDaily = this.entries.find(e => e.kind === 'daily' && e.state === 'interrupted' && !e.reported && e.target <= now);
      if (interruptedDaily) {
        await this.log('warn', 'preflight-result', '지난 일일 예약 점검 중단 · 최종 제출 없음', { planId: 'daily-health', key: interruptedDaily.key, kind: 'daily', state: 'interrupted', code: 'PREFLIGHT_INTERRUPTED' });
        interruptedDaily.reported = true;
        interruptedDaily.state = 'failed';
        await this.persist();
      }
      // Never compete with any real reservation's final five minutes.
      if (plans.some(p => p.enabled && triggerEpoch(p.config.triggerAt) > now && triggerEpoch(p.config.triggerAt) - now < 300000)) return;
      const waiting = plans.filter(p => p.enabled && p.kind === 'scheduled' && p.status.state === 'waiting' && p.status.stage === 'armed' && p.config.siteVersion === 'swimozicamp-v1');
      if (this.dailyConfig && now >= at(day(now), 10) && !this.entries.some(e => e.key === dailyPreflightKey(now) && e.reported)) {
        let config;
        try { config = await this.dailyConfig(); config.preflightRequestedSites = [...new Set(plans.filter(p=>p.enabled).flatMap(p=>[...(p.config.roomPriority||[]), ...getProfiles(p.config).flatMap(profile=>profile.roomPriority||[])]).filter(r=>r.enabled).map(r=>r.name))]; }
        catch { config = { preflightConfigError: true }; }
        waiting.push({ id: 'daily-health', kind: 'daily', enabled: true, config, status: { state: 'waiting' } });
      }
      for (const plan of waiting) {
        const daily = plan.kind === 'daily';
        const target = daily ? at(day(now), 19) : triggerEpoch(plan.config.triggerAt), key = daily ? dailyPreflightKey(now) : preflightKey(plan);
        const dueAt = daily ? at(day(now), 10) : preflightDue(target);
        if (!Number.isFinite(target) || target <= now || now < dueAt) continue;
        let entry = this.entries.find(e => e.key === key);
        if (entry && entry.reported) continue;
        if (entry && entry.state === 'checking') continue;
        if (!entry) { entry = { key, planId: plan.id, kind: daily ? 'daily' : 'scheduled', target, dueAt, startedAt: now, state: 'checking' }; this.entries.push(entry); }
        if (entry.state === 'checking') {
          // Retain all active keys, prune only old records, before invoking site code.
          const active = new Set(waiting.map(preflightKey));
          this.entries = this.entries.filter(e => active.has(e.key) || e.target > now - 90 * DAY);
          await this.persist();
          const controller = new AbortController();
          this.controller = controller;
          let engine;
          const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(this.timeoutMs, at(day(this.now()), 19) - this.now())));
          try {
            if (plan.config.preflightConfigError) throw problem('PREFLIGHT_CONFIG_UNAVAILABLE', 'profile-read');
            engine = this.engineFactory(plan);
            const inspection = this.inspect(engine, structuredClone(plan.config), now, controller.signal);
            const deadline = new Promise((_, reject) => {
              const stop = () => reject(problem('PREFLIGHT_INTERRUPTED', engine.currentStep));
              if (controller.signal.aborted) stop();
              else controller.signal.addEventListener('abort', stop, { once: true });
            });
            entry.result = await Promise.race([inspection, deadline]);
            if (daily) entry.result.profileSource = plan.config.preflightProfileSource;
            if (controller.signal.aborted) throw problem('PREFLIGHT_INTERRUPTED', engine.currentStep);
            entry.state = 'passed';
          } catch (error) {
            entry.state = error.code === 'PREFLIGHT_NO_VACANCY' ? 'unavailable' : 'failed';
            // Store only a bounded machine code/known step, never raw form values.
            entry.code = /^[A-Z_]{1,60}$/.test(error.code || '') ? error.code : 'PREFLIGHT_FAILED';
            entry.step = /^[a-z-]{1,60}$/.test(error.step || '') ? error.step : 'unknown';
          } finally { clearTimeout(timeout); await engine?.close(); this.controller = null; }
          entry.finishedAt = this.now();
          await this.persist();
        }
        // Stopping/editing during a check suppresses a stale result notification.
        const current = daily ? plan : (await this.list()).find(p => p.id === plan.id);
        if (!this.closed && current?.enabled && current.status.state === 'waiting' && (daily || preflightKey(current) === key)) {
          const message = daily ? `일일 예약 점검 ${entry.state === 'passed' ? '통과' : entry.state === 'unavailable' ? '미완료 · 점검용 빈자리 없음' : '확인 필요'} · 최종 제출 없음` : '예약 사전 점검 결과 · 최종 제출하지 않았습니다.';
          await this.log(entry.state === 'passed' ? 'info' : 'warn', 'preflight-result', message, { planId: plan.id, key, kind: entry.kind, state: entry.state, code: entry.code, step: entry.step, result: entry.result });
          entry.reported = true;
          await this.persist();
        }
        // interrupted markers notify once; no silent automatic retry after restart.
        if (entry.state === 'interrupted') { entry.state = 'failed'; await this.persist(); }
        break; // one bounded browser operation at a time
      }
    } finally { this.running = false; }
  }
  async close() { this.closed = true; clearInterval(this.timer); this.controller?.abort(); }
}
