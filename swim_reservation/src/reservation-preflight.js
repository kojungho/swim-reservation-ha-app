import { createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { bookingOpenIso, triggerEpoch, getProfiles } from './config.js';

const DAY = 86400000, OFFSET = 9 * 3600000;
const day = now => new Date(now + OFFSET).toISOString().slice(0, 10);
const at = (date, hour) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00+09:00`);
export function preflightDue(trigger) { return at(day(trigger - DAY), 10); }
export function preflightWindow(now) { return now >= at(day(now), 8) && now < at(day(now), 19); }
export function preflightKey(plan) { return createHash('sha256').update(JSON.stringify([plan.id, plan.config])).digest('hex'); }
export function preflightDates(now) {
  return [1, 2, 7, 14, 21, 28, 35].map(offset => day(now + offset * DAY))
    .filter(date => triggerEpoch(bookingOpenIso(date)) <= now);
}
const problem = (code, step) => Object.assign(new Error(code), { code, step });

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
    for (const startDate of preflightDates(now)) {
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
    return { checkin: candidate.startDate, nights: 1, site: candidate.roomPriority[0].name, profilesChecked: getProfiles(config).length, submitted: false };
  } finally {
    signal?.removeEventListener('abort', abort);
    await engine.close();
  }
}

// Journal one check per immutable waiting configuration. Restart, stop, edit and
// a failed check cannot start a booking or replace the real reservation status.
export class ReservationPreflight {
  constructor({ dataDir, list, engineFactory, log, now = Date.now, canCheck = () => true, inspect = inspectReservationPreflight, timeoutMs = 120000 }) {
    Object.assign(this, { list, engineFactory, log, now, canCheck, inspect, timeoutMs });
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
      // Never compete with any real reservation's final five minutes.
      if (plans.some(p => p.enabled && triggerEpoch(p.config.triggerAt) > now && triggerEpoch(p.config.triggerAt) - now < 300000)) return;
      const waiting = plans.filter(p => p.enabled && p.kind === 'scheduled' && p.status.state === 'waiting' && p.status.stage === 'armed' && p.config.siteVersion === 'swimozicamp-v1');
      for (const plan of waiting) {
        const target = triggerEpoch(plan.config.triggerAt), key = preflightKey(plan);
        if (!Number.isFinite(target) || target <= now || now < preflightDue(target)) continue;
        let entry = this.entries.find(e => e.key === key);
        if (entry && entry.reported) continue;
        if (entry && entry.state === 'checking') continue;
        if (!entry) { entry = { key, planId: plan.id, target, dueAt: preflightDue(target), startedAt: now, state: 'checking' }; this.entries.push(entry); }
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
            engine = this.engineFactory(plan);
            const inspection = this.inspect(engine, structuredClone(plan.config), now, controller.signal);
            const deadline = new Promise((_, reject) => {
              const stop = () => reject(problem('PREFLIGHT_INTERRUPTED', engine.currentStep));
              if (controller.signal.aborted) stop();
              else controller.signal.addEventListener('abort', stop, { once: true });
            });
            entry.result = await Promise.race([inspection, deadline]);
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
        const current = (await this.list()).find(p => p.id === plan.id);
        if (!this.closed && current?.enabled && current.status.state === 'waiting' && preflightKey(current) === key) {
          await this.log(entry.state === 'passed' ? 'info' : 'warn', 'preflight-result', '예약 사전 점검 결과 · 최종 제출하지 않았습니다.', { planId: plan.id, key, state: entry.state, code: entry.code, step: entry.step, result: entry.result });
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
