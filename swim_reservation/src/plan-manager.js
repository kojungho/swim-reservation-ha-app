import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { Store } from "./store.js";
import { Scheduler } from "./scheduler.js";
import { normalizeConfig, validateConfig, getProfiles, bookingOpenIso, triggerEpoch } from "./config.js";

// Each plan owns its configuration, status and browser. Editor changes never affect armed plans.
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
    const rows = [...this.plans.values()].map(({ id, name, kind, intervalSeconds, enabled, config }) => ({ id, name, kind, intervalSeconds, enabled, config }));
    await writeFile(`${this.file}.tmp`, JSON.stringify(rows), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }
  async createRuntime(row) {
    const store = new Store(path.join(this.dataDir, "plans", row.id));
    await store.init();
    const recordLog = store.recordLog.bind(store);
    store.recordLog = async (level, event, message, details) => {
      const entry = await recordLog(level, event, message, details);
      await this.log(level, event, `${row.name}: ${message}`, { planId: row.id, ...details });
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
      const plan = await this.createRuntime(row);
      this.plans.set(plan.id, plan);
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
    return Promise.all([...this.plans.values()].map(async plan => ({ id: plan.id, name: plan.name, kind: plan.kind, intervalSeconds: plan.intervalSeconds, enabled: plan.enabled, config: plan.config, status: await plan.store.getStatus() })));
  }
  async add(input) {
    return this.locked(async () => {
      if (this.plans.size >= 20) throw new Error("저장 일정은 최대 20개입니다. 사용하지 않는 일정을 삭제해 주세요.");
      if (!["scheduled", "watch", "now"].includes(input.kind)) throw new Error("일정 종류를 확인해 주세요.");
      const config = normalizeConfig(input.config);
      const errors = validateConfig(config);
      if (errors.length) throw new Error(`확인할 항목: ${errors.join(", ")}`);
      const plan = await this.createRuntime({ id: randomUUID(), name: String(input.name || `${config.startDate} ${config.nights}박`).trim().slice(0, 80), kind: input.kind, intervalSeconds: Math.max(60, Math.min(3600, Math.trunc(Number(input.intervalSeconds) || 60))), enabled: false, config });
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
  async start(id) {
    return this.locked(async () => {
      const plan = this.get(id);
      if (plan.enabled || plan.checking || plan.scheduler.running || plan.scheduler.preparing) throw new Error("이미 진행 중인 일정입니다.");
      if ([...this.plans.values()].filter(item => item.enabled).length >= 5) throw new Error("동시 진행 일정은 최대 5개입니다.");
      const generation = ++plan.generation;
      const status = await plan.store.getStatus();
      if (generation !== plan.generation) return;
      if (["success", "running", "failed"].includes(status.state)) throw new Error("완료 또는 결과 확인이 필요한 일정입니다. 예약확인 후 새 일정으로 등록해 주세요.");
      await this.timeSync.ensureSynced();
      if (generation !== plan.generation) return;
      if (plan.kind === "scheduled") await plan.scheduler.arm(plan.config);
      else if (plan.kind === "now") await plan.scheduler.runNow(plan.config);
      else await plan.store.updateStatus({ state: "waiting", stage: "watching", message: "설정 날짜·박수·객실에 맞는 취소 자리를 감시합니다." });
      if (generation !== plan.generation) return;
      plan.enabled = true;
      await this.persist();
      this.schedule(plan, plan.kind === "watch" ? 1 : 1000);
      await this.log("info", "plan-start", `${plan.name}: ${plan.kind === "watch" ? "취소 자리 감시" : plan.kind === "now" ? "즉시 예약" : "예약 대기"} 시작`);
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
    plan.timer = setTimeout(() => this.poll(plan).catch(error => this.log("error", "plan-watch", error.message)), delay);
    plan.timer.unref?.();
  }
  async poll(plan) {
    if (!plan.enabled || plan.checking || this.closed) return;
    const generation = plan.generation;
    plan.checking = true;
    try {
      if (plan.scheduler.running || plan.scheduler.preparing) return;
      const status = await plan.store.getStatus();
      if (["success", "failed"].includes(status.state)) { plan.enabled = false; await this.locked(() => this.persist()); return; }
      if (plan.kind !== "watch") return;
      const now = await this.timeSync.ensureSynced();
      if (plan.config.startDate < new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now))) {
        plan.enabled = false;
        await plan.store.updateStatus({ state: "stopped", stage: "expired", message: "숙박 시작 날짜가 지나 감시를 종료했습니다." });
        await this.locked(() => this.persist());
        return;
      }
      const opensAt = bookingOpenIso(plan.config.startDate);
      if (now < triggerEpoch(opensAt)) {
        await plan.store.updateStatus({ state: "waiting", stage: "watch-before-open", message: `${opensAt} 예약 오픈 후 취소 자리 조회를 시작합니다.` });
        return;
      }
      if (!this.canInspect() || this.busy) return;
      plan.controller = new AbortController();
      const rooms = await this.inspect(plan.config, plan.controller.signal);
      if (!plan.enabled || generation !== plan.generation || this.closed) return;
      plan.failures = 0;
      const matchedConfig = watchConfiguration(plan.config, rooms);
      const matches = Boolean(matchedConfig);
      await plan.store.updateStatus({ state: "waiting", stage: matches ? "watch-found" : "watching", lastCheckedAt: now, roomAvailability: rooms, message: matches ? "조건에 맞는 객실을 발견했습니다. 예약을 시도합니다." : "조건에 맞는 객실이 없어 감시를 계속합니다." });
      if (matches) {
        if (!plan.enabled || generation !== plan.generation || this.closed) return;
        // The engine rechecks date and availability immediately before final submission.
        await plan.scheduler.runNow({ ...matchedConfig, triggerAt: opensAt });
        await this.log("info", "watch-found", `${plan.name}: 취소 자리 조건 일치, 예약 시도`);
      }
    } catch (error) {
      if (!plan.enabled || generation !== plan.generation || this.closed) return;
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
  if (config.bookingMode === "profiles-parallel") {
    const profiles = getProfiles(config), owners = new Map();
    const assign = (index, seen) => {
      for (const name of selected(profiles[index].roomPriority)) {
        if (!available.has(name) || seen.has(name)) continue;
        seen.add(name);
        if (!owners.has(name) || assign(owners.get(name), seen)) { owners.set(name, index); return true; }
      }
      return false;
    };
    if (!profiles.every((_, index) => assign(index, new Set()))) return null;
    return { ...config, profiles: profiles.map((profile, index) => {
      const first = [...owners].find(([, owner]) => owner === index)[0];
      return { ...profile, roomPriority: [...profile.roomPriority.filter(room => room.name === first), ...profile.roomPriority.filter(room => room.name !== first)] };
    }) };
  }
  const names = selected(config.roomPriority);
  return names.length > 0 && (config.bookingMode === "multiple" ? names.every(name => available.has(name)) : names.filter(name => available.has(name)).length >= getProfiles(config).length) ? config : null;
}
