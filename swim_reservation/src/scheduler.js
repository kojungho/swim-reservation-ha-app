import { triggerEpoch } from "./config.js";

const HOUR = 60 * 60 * 1000;
const PREWARM_MS = 15_000;

export class Scheduler {
  constructor({ store, engine }) {
    this.store = store;
    this.engine = engine;
    this.timer = null;
    this.armed = false;
    this.prepared = false;
    this.running = false;
    this.cancelRequested = false;
  }

  async restore() {
    const status = await this.store.getStatus();
    if (status.state !== "waiting") return;
    const config = await this.store.getConfig();
    if (triggerEpoch(config.triggerAt) <= Date.now()) {
      await this.store.updateStatus({ state: "failed", stage: "missed", message: "App이 중지된 동안 예약 실행 시각이 지났습니다." });
      return;
    }
    this.arm(config, { restored: true });
  }

  async arm(config, { restored = false } = {}) {
    if (this.running) throw new Error("이미 예약 엔진이 실행 중입니다.");
    this.stopTimer();
    this.armed = true;
    this.prepared = false;
    this.cancelRequested = false;
    if (!restored) {
      await this.store.updateStatus({
        state: "waiting",
        stage: "armed",
        targetAt: triggerEpoch(config.triggerAt),
        selectedRoom: null,
        diagnostics: null,
        message: "예약 실행 시각을 기다리는 중입니다."
      });
    }
    this.scheduleTick();
  }

  async stop() {
    this.cancelRequested = true;
    this.armed = false;
    this.prepared = false;
    this.running = false;
    this.stopTimer();
    await this.engine.close();
    return this.store.updateStatus({ state: "stopped", stage: "stopped", message: "예약 실행을 중지했습니다." });
  }

  async runNow(config) {
    if (this.running) throw new Error("이미 예약 엔진이 실행 중입니다.");
    this.stopTimer();
    this.armed = false;
    this.prepared = false;
    this.running = true;
    this.cancelRequested = false;
    await this.store.updateStatus({
      state: "running",
      stage: "starting-now",
      targetAt: Date.now(),
      selectedRoom: null,
      diagnostics: null,
      message: "즉시 예약을 시작합니다.",
      startedAt: Date.now()
    });
    this.execute(config, { prepared: false }).catch((error) => this.fail(error));
  }

  scheduleTick() {
    if (!this.armed) return;
    this.timer = setTimeout(() => this.tick().catch((error) => this.fail(error)), 100);
  }

  async tick() {
    if (!this.armed) return;
    const config = await this.store.getConfig();
    const target = triggerEpoch(config.triggerAt);
    const remaining = target - Date.now();

    if (!this.prepared && remaining <= PREWARM_MS && remaining > 0) {
      this.prepared = true;
      await this.store.updateStatus({ stage: "prewarming", message: "예약 브라우저를 미리 준비하고 있습니다." });
      await this.engine.prepare(config);
    }

    if (remaining <= 0) {
      this.armed = false;
      this.running = true;
      await this.store.updateStatus({ state: "running", stage: "starting", message: "예약을 시작합니다.", startedAt: Date.now() });
      await this.execute(config, { prepared: this.prepared });
      return;
    }

    const delay = remaining > HOUR ? HOUR : remaining > PREWARM_MS ? Math.min(remaining - PREWARM_MS, 30_000) : Math.min(remaining, 50);
    this.timer = setTimeout(() => this.tick().catch((error) => this.fail(error)), Math.max(10, delay));
  }

  async fail(error) {
    this.armed = false;
    this.running = false;
    this.stopTimer();
    await this.engine.close();
    if (this.cancelRequested) {
      await this.store.updateStatus({ state: "stopped", stage: "stopped", message: "예약 실행을 중지했습니다." });
      return;
    }
    const current = await this.store.getStatus();
    if (current.state === "failed") return;
    await this.store.updateStatus({ state: "failed", stage: "exception", message: error.message || String(error) });
  }

  async execute(config, options) {
    try {
      await this.engine.run(config, options);
    } finally {
      this.running = false;
    }
  }

  stopTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
