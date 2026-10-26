import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { Store } from "./store.js";
import { Scheduler } from "./scheduler.js";
import { normalizeConfig, validateConfig, getProfiles, bookingOpenIso, triggerEpoch } from "./config.js";
import { operationTrace, maskedProfile } from './camp-trace.js';

// Each plan owns its configuration, status and browser. Editor changes never affect armed plans.
function planRevision(plan) { return createHash("sha256").update(JSON.stringify([plan.name, plan.kind, plan.config, plan.intervalSeconds, plan.watchEndsAt || ""])).digest("hex"); }
export class PlanManager {
  constructor({ dataDir, timeSync, engineFactory, inspect, log = async () => {}, canInspect = () => true }) {
    Object.assign(this, { dataDir, timeSync, engineFactory, inspect, log, canInspect });
    this.file = path.join(dataDir, "reservation-plans.json");
    this.plans = new Map();
    this.queue = Promise.resolve();
    this.closed = false;
  }
  locked(action) {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  async persist() {
    const rows = [...this.plans.values()].map(({ id, name, kind, intervalSeconds, enabled, config, watchVersion, watchEndsAt }) => ({ id, name, kind, intervalSeconds, enabled, config, watchVersion, watchEndsAt }));
    await writeFile(`${this.file}.tmp`, JSON.stringify(rows), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
  async createRuntime(row) {
    if (row.kind === "watch") row.watchEndsAt = normalizeWatchEndsAt(row.watchEndsAt);
    const store = new Store(path.join(this.dataDir, "plans", row.id));
    await store.init();
    const recordLog = store.recordLog.bind(store);
    store.recordLog = async (level, event, message, details) => {
      const entry = await recordLog(level, event, message, details);
      await this.log(level, event, `${this.plans.get(row.id)?.name || row.name}: ${message}`, { planId: row.id, ...details });
      return entry;
    };
    await store.saveConfig(row.config, { recordHistory: false });
    const scheduler = new Scheduler({ store, engine: this.engineFactory(store), timeSync: this.timeSync });
    return { ...row, store, scheduler, timer: null, checking: false, failures: 0, generation: 0 };
  }
  async init() {
    await mkdir(this.dataDir, { recursive: true });
    let rows;
    try { rows = JSON.parse(await readFile(this.file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; rows = []; }
    for (const row of rows) {
      if (!/^[a-f0-9-]{36}$/.test(row.id)) throw new Error("일정 저장 파일의 식별값을 확인해 주세요.");
      const legacyWatch = row.kind === "watch" && row.watchVersion !== 2;
      const legacySingle = row.kind !== "watch" && row.config.bookingMode === "priority" && getProfiles(row.config).length > 1;
      const siteChanged = row.config.siteVersion !== 'swimozicamp-v1';
      if (siteChanged) row.enabled = false;
      if (legacyWatch) {
        row.config = normalizeWatchConfig(row.config, row.config.bookingMode === "multiple" ? row.config.multipleProfileIndex || 0 : 0);
        row.watchVersion = 2;
        row.enabled = false;
      }
      if (legacySingle) { row.config = singleBookingConfig(row.config); row.enabled = false; }
      if (row.kind !== "watch" && row.config.bookingMode === "multiple") row.config = singleBookingConfig(row.config);
      const plan = await this.createRuntime(row);
      this.plans.set(plan.id, plan);
      if (legacyWatch || legacySingle || siteChanged) {
        const old = await plan.store.getStatus();
        if (old.state === "running") await plan.store.updateStatus({ state: "failed", stage: "review-required", message: "기존 감시 실행 결과를 예약확인에서 확인하세요. 자동 재제출하지 않습니다." });
        else if (!["success", "failed"].includes(old.state)) await plan.store.updateStatus({ state: "stopped", stage: "stopped", message: siteChanged ? '공식 예약 사이트가 변경되었습니다. 기존 일정은 자동 재개하지 않습니다. 사이트·날짜·예약자를 확인하고 수정 저장해 주세요.' : legacySingle ? "1개 예약 모드가 한 명의 예약으로 변경되었습니다. 예약자를 확인한 후 시작하세요." : "취소 대기가 순위 없는 한 객실 예약으로 변경되었습니다. 예약자와 체크한 객실을 확인한 후 시작하세요." });
      }
      if (!plan.enabled) continue;
      const status = await plan.store.getStatus();
      if (["running", "failed", "success"].includes(status.state) || status.stage === "prewarming" || /final-ready/.test(status.stage || "")) {
        plan.enabled = false;
        if (status.state !== "success") await plan.store.updateStatus({ state: "failed", stage: "review-required", message: "재시작 전 실행 결과를 예약확인에서 확인하세요. 중복 방지를 위해 자동 재실행하지 않습니다." });
      } else if (plan.kind === "watch") this.schedule(plan, 1000);
      else if (status.state === "waiting") {
        try { await plan.scheduler.restore(); this.schedule(plan, 1000); }
        catch (error) { plan.enabled = false; await plan.store.updateStatus({ state: "failed", stage: "review-required", message: error.message }); }
      }
      else plan.enabled = false;
    }
    await this.persist();
  }
  async list() {
    return Promise.all([...this.plans.values()].map(async plan => ({ id: plan.id, revision: planRevision(plan), name: plan.name, kind: plan.kind, intervalSeconds: plan.intervalSeconds, watchEndsAt: plan.watchEndsAt || "", watchDeadlineAt: plan.kind === "watch" ? watchDeadlineAt(plan) : null, enabled: plan.enabled, config: plan.config, status: await plan.store.getStatus() })));
  }
  async add(input) {
    return this.locked(async () => {
      if (this.plans.size >= 20) throw new Error("저장 일정은 최대 20개입니다. 사용하지 않는 일정을 삭제해 주세요.");
      if (!["scheduled", "watch", "now"].includes(input.kind)) throw new Error("일정 종류를 확인해 주세요.");
      const config = input.kind === "watch" ? normalizeWatchConfig(input.config, Number(input.watchProfileIndex ?? 0)) : singleBookingConfig(input.config);
      const errors = validateConfig(config);
      if (errors.length) throw new Error(`확인할 항목: ${errors.join(", ")}`);
      const reservationDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(this.timeSync.now()));
      const name = input.kind === 'now' ? reservationDate : String(input.name || `${config.startDate} ${config.nights}박`).trim().slice(0, 80);
      const plan = await this.createRuntime({ id: randomUUID(), name, kind: input.kind, watchVersion: input.kind === "watch" ? 2 : undefined, watchEndsAt: input.kind === "watch" ? normalizeWatchEndsAt(input.watchEndsAt) : undefined, intervalSeconds: Math.max(60, Math.min(3600, Math.trunc(Number(input.intervalSeconds) || 60))), enabled: false, config });
      this.plans.set(plan.id, plan);
      await this.persist();
      return plan.id;
    });
  }
  get(id) {
    const plan = this.plans.get(id);
    if (!plan) throw new Error("일정을 찾지 못했습니다.");
    return plan;
  }
  async update(id, input) {
    return this.locked(async () => {
      const plan = this.get(id);
      if (plan.enabled || plan.checking || plan.scheduler.running || plan.scheduler.preparing) throw new Error("먼저 일정을 중지하고 진행 작업이 끝난 후 수정해 주세요.");
      const status = await plan.store.getStatus();
      if (!["idle", "stopped"].includes(status.state)) throw new Error("완료 또는 결과 확인이 필요한 일정은 수정할 수 없습니다. 예약확인 후 새 일정으로 등록해 주세요.");
      if (!["scheduled", "watch", "now"].includes(input.kind)) throw new Error("일정 종류를 확인해 주세요.");
      const config = input.kind === "watch" ? normalizeWatchConfig(input.config, Number(input.watchProfileIndex ?? 0)) : singleBookingConfig(input.config);
      const errors = validateConfig(config);
      if (errors.length) throw new Error(`확인할 항목: ${errors.join(", ")}`);
      const watchEndsAt = input.kind === "watch" ? normalizeWatchEndsAt(input.watchEndsAt) : undefined;
      await plan.store.saveConfig(config, { recordHistory: false });
      clearTimeout(plan.timer);
      Object.assign(plan, { name: String(input.name || `${config.startDate} ${config.nights}박`).trim().slice(0, 80), kind: input.kind, config,
        watchEndsAt, watchVersion: input.kind === "watch" ? 2 : undefined, intervalSeconds: Math.max(60, Math.min(3600, Math.trunc(Number(input.intervalSeconds) || 60))), failures: 0 });
      plan.generation++;
      await plan.store.updateStatus({ state: "stopped", stage: "stopped", message: "일정 수정을 저장했습니다. 시작을 눌러 다시 실행하세요.", targetAt: null, prepareAt: null, armedConfig: null, selectedRoom: null, selectedRooms: [], succeededRooms: [], failedRooms: [], profileStatuses: [], technicalMessage: null, lastCheckedAt: null });
      await this.persist();
      await this.log("info", "plan-updated", `${plan.name}: 중지된 일정 수정 저장`, { planId: id });
      return id;
    });
  }
  async start(id, { expectedRevision } = {}) {
    return this.locked(async () => {
      const plan = this.get(id);
      if (expectedRevision !== undefined && expectedRevision !== planRevision(plan)) throw new Error("일정이 다른 화면에서 변경되었습니다. 최신 내용을 다시 확인하고 시작해 주세요.");
      if (plan.scheduler.engine.supportsPrewarm === false && plan.config.siteVersion !== 'swimozicamp-v1') throw new Error('이전 사이트 일정입니다. 수정 저장 후 새 사이트 설정을 확인하고 시작해 주세요.');
      if (plan.enabled || plan.checking || plan.scheduler.running || plan.scheduler.preparing) throw new Error("이미 진행 중인 일정입니다.");
      if ([...this.plans.values()].filter(item => item.enabled).length >= 5) throw new Error("동시 진행 일정은 최대 5개입니다.");
      const generation = ++plan.generation;
      const status = await plan.store.getStatus();
      if (generation !== plan.generation) return;
      if (["success", "running", "failed"].includes(status.state)) throw new Error("완료 또는 결과 확인이 필요한 일정입니다. 예약확인 후 새 일정으로 등록해 주세요.");
      const now = await this.timeSync.ensureSynced();
      if (generation !== plan.generation) return;
      if (plan.kind === "watch" && now >= triggerEpoch(watchDeadlineAt(plan))) {
        await plan.store.updateStatus({ state: "stopped", stage: "expired", message: watchExpiryMessage(plan) });
        await this.persist();
        return;
      }
      if (plan.kind === "scheduled") await plan.scheduler.arm(plan.config);
      else if (plan.kind === "now") await plan.scheduler.runNow(plan.config);
      else await plan.store.updateStatus({ state: "waiting", stage: "watching", message: "설정 날짜·박수·객실에 맞는 취소 자리를 감시합니다." });
      if (generation !== plan.generation) return;
      plan.enabled = true;
      await this.persist();
      this.schedule(plan, plan.kind === "watch" ? 1 : 1000);
      await this.log("info", "plan-start", `${plan.name}: ${plan.kind === "watch" ? "취소 대기" : plan.kind === "now" ? "즉시 예약" : "예약 대기"} 시작`);
    });
  }
  async stop(id) {
    const plan = this.get(id);
    // Cancel flags must be visible immediately, even while a browser read is outstanding.
    plan.enabled = false;
    plan.generation++;
    clearTimeout(plan.timer);
    plan.controller?.abort();
    const submitting = plan.scheduler.running;
    // Invalidate a run waiting on time synchronisation before reading/writing status.
    plan.scheduler.operation++;
    const previous = await plan.store.getStatus();
    if (!["success", "failed"].includes(previous.state)) {
      await plan.scheduler.stop();
      if (submitting || previous.stage === "watch-found") await plan.store.updateStatus({ state: "failed", stage: "review-required", message: "예약 실행 중 중지했습니다. 실제 예약 여부를 예약확인에서 확인한 후 새 일정을 등록하세요." });
    }
    await this.locked(() => this.persist());
  }
  async remove(id) {
    return this.locked(async () => {
      const plan = this.get(id);
      if (plan.enabled || plan.checking || plan.scheduler.running || plan.scheduler.preparing) throw new Error("먼저 일정을 중지하고 진행 작업이 끝난 후 삭제해 주세요.");
      clearTimeout(plan.timer);
      this.plans.delete(id);
      await this.persist();
      // Keep per-plan files for recovery and audit; deletion only removes the list entry.
    });
  }
  get busy() { return [...this.plans.values()].some(plan => plan.scheduler.running || plan.scheduler.preparing); }
  schedule(plan, delay = plan.intervalSeconds * 1000) {
    clearTimeout(plan.timer);
    if (!plan.enabled || this.closed) return;
    if (plan.kind === "watch") {
      const remaining = triggerEpoch(watchDeadlineAt(plan)) - this.timeSync.now();
      if (Number.isFinite(remaining)) delay = Math.min(delay, remaining > 0 ? remaining : plan.failures ? delay : 1000);
    }
    plan.timer = setTimeout(() => this.poll(plan).catch(error => this.log("error", "plan-watch", error.message, { planId: plan.id })), delay);
    plan.timer.unref?.();
  }
  async poll(plan) {
    if (!plan.enabled || plan.checking || this.closed) return;
    const generation = plan.generation;
    plan.checking = true;
    try {
      if (plan.scheduler.running || plan.scheduler.preparing) return;
      const status = await plan.store.getStatus();
      if (["success", "failed"].includes(status.state) || status.stage === "expired") { plan.enabled = false; await this.locked(() => this.persist()); return; }
      if (plan.kind !== "watch") return;
      const now = await this.timeSync.ensureSynced();
      if (now >= triggerEpoch(watchDeadlineAt(plan))) {
        await this.expireWatch(plan);
        return;
      }
      const opensAt = bookingOpenIso(plan.config.startDate);
      if (now < triggerEpoch(opensAt)) {
        await plan.store.updateStatus({ state: "waiting", stage: "watch-before-open", message: `${opensAt} 예약 오픈 후 취소 자리 조회를 시작합니다.` });
        return;
      }
      if (!this.canInspect() || this.busy) return;
      plan.controller = new AbortController();
      const checkId = randomUUID();
      const trace = operationTrace((...args) => plan.store.recordLog(...args), { planId: plan.id, attemptId: checkId, profile: maskedProfile(getProfiles(plan.config)[0]) }, 'watch-step');
      let rooms;
      try { rooms = await trace.step('watch-lookup', () => this.inspect(plan.config, plan.controller.signal, { planId: plan.id, attemptId: checkId })); }
      finally { await trace.flush(); }
      if (!plan.enabled || generation !== plan.generation || this.closed) return;
      if (this.timeSync.now() >= triggerEpoch(watchDeadlineAt(plan))) { await this.expireWatch(plan); return; }
      plan.failures = 0;
      let matchedConfig;
      try { matchedConfig = await trace.step('watch-match', async () => {
        const matched = watchConfiguration(plan.config, rooms);
        trace.emit('watch-match', 'checks', { matched: Boolean(matched), availableCount: rooms.filter(room => room.available).length });
        return matched;
      }); }
      finally { await trace.flush(); }
      const matches = Boolean(matchedConfig);
      await plan.store.updateStatus({ state: "waiting", stage: matches ? "watch-found" : "watching", lastCheckedAt: now, roomAvailability: rooms, message: matches ? "조건에 맞는 객실을 발견했습니다. 예약을 시도합니다." : "조건에 맞는 객실이 없어 감시를 계속합니다." });
      if (matches) {
        if (!plan.enabled || generation !== plan.generation || this.closed) return;
        // The engine rechecks date and availability immediately before final submission.
        await plan.scheduler.runNow({ ...matchedConfig, triggerAt: opensAt }, { beforeSubmit: () => {
          const remaining = triggerEpoch(watchDeadlineAt(plan)) - this.timeSync.now();
          if (remaining <= 0) {
            const error = new Error(watchExpiryMessage(plan));
            error.code = "WATCH_DEADLINE";
            throw error;
          }
          return remaining;
        } });
        await this.log("info", "watch-found", `${plan.name}: 취소 자리 조건 일치, 예약 시도`);
      }
    } catch (error) {
      if (!plan.enabled || generation !== plan.generation || this.closed) return;
      if (error.code === "WATCH_DEADLINE") { await this.expireWatch(plan); return; }
      plan.failures++;
      if (plan.scheduler.running) return;
      const status = await plan.store.getStatus();
      if (["success", "failed"].includes(status.state)) { plan.enabled = false; await this.locked(() => this.persist()); }
      else await plan.store.updateStatus({ state: "waiting", stage: "watch-read-error", message: `조회 실패로 예약하지 않았습니다. 재조회 대기: ${error.message}`, lastCheckedAt: this.timeSync.now() });
    } finally {
      plan.checking = false;
      plan.controller = null;
      this.schedule(plan, plan.scheduler.running || plan.kind !== "watch" ? 1000 : plan.intervalSeconds * 1000 * Math.min(8, 2 ** plan.failures));
    }
  }
  async expireWatch(plan) {
    plan.enabled = false;
    await plan.store.updateStatus({ state: "stopped", stage: "expired", message: watchExpiryMessage(plan) });
    await this.locked(() => this.persist());
  }
  async close() {
    this.closed = true;
    for (const plan of this.plans.values()) {
      clearTimeout(plan.timer);
      plan.controller?.abort();
      plan.scheduler.stopTimer();
      await plan.scheduler.engine.close();
      await plan.store.logQueue;
    }
  }
}

export function matchWatchRooms(config, rooms) {
  return Boolean(watchConfiguration(config, rooms));
}

export function watchConfiguration(config, rooms) {
  const available = new Set(rooms.filter(room => room.available === true && room.status === "available").map(room => room.name));
  const selected = list => (list || []).filter(room => room.enabled).map(room => room.name);
  const names = new Set(selected(config.roomPriority));
  if (![...names].some(name => available.has(name))) return null;
  // Site order only: persisted checkbox order is not a user-defined preference.
  return { ...config, bookingMode: "priority", roomPriority: rooms.filter(room => names.has(room.name)).map(room => ({ name: room.name, enabled: true })) };
}

export function normalizeWatchConfig(input, profileIndex = 0) {
  const config = normalizeConfig(input);
  const profiles = getProfiles(config);
  if (!Number.isInteger(profileIndex) || profileIndex < 0 || profileIndex >= profiles.length) throw new Error("취소 자리 예약자 한 명을 선택해 주세요.");
  const eligible = config.bookingMode === "profiles-parallel" ? [...new Set(profiles.flatMap(profile => (profile.roomPriority || []).filter(room => room.enabled).map(room => room.name)))] : config.roomPriority.filter(room => room.enabled).map(room => room.name);
  return normalizeConfig({ ...config, bookingMode: "priority", profiles: [profiles[profileIndex]], multipleProfileIndex: 0, triggerAt: bookingOpenIso(config.startDate), roomPriority: eligible.map(name => ({ name, enabled: true })) });
}

export function singleBookingConfig(input) {
  const config = normalizeConfig(input);
  if (config.bookingMode === "profiles-parallel") return config;
  const profile = getProfiles(config)[config.multipleProfileIndex || 0];
  if (!profile) throw new Error("예약에 사용할 한 명을 선택해 주세요.");
  return normalizeConfig({ ...config, profiles: [profile], multipleProfileIndex: 0 });
}

export function normalizeWatchEndsAt(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error("감시 마감 날짜·시각을 확인하세요.");
  const canonical = value.length === 16 ? `${value}:00` : value;
  const epoch = triggerEpoch(canonical);
  if (!Number.isFinite(epoch) || new Date(epoch + 9 * 3600_000).toISOString().slice(0, 19) !== canonical) throw new Error("감시 마감 날짜·시각을 확인하세요.");
  return canonical;
}
export function watchDeadlineAt(plan) { return plan.watchEndsAt || `${plan.config.startDate}T00:00:00`; }
function watchExpiryMessage(plan) {
  return plan.watchEndsAt ? `지정한 감시 마감 시각이 되어 감시를 종료했습니다: ${plan.watchEndsAt.replace("T", " ")}` : "숙박 시작일 00시가 되어 감시를 종료했습니다. 기본 설정에서는 당일 예약하지 않습니다.";
}
