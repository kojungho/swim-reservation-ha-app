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
    this.stopTimer();
    this.armed = true;
    this.prepared = false;
    if (!restored) {
      await this.store.updateStatus({
        state: "waiting",
        stage: "armed",
        targetAt: triggerEpoch(config.triggerAt),
        selectedRoom: null,
        message: "예약 실행 시각을 기다리는 중입니다."
      });
    }
    this.scheduleTick();
  }

  async stop() {
    this.armed = false;
    this.prepared = false;
    this.stopTimer();
    await this.engine.close();
    return this.store.updateStatus({ state: "stopped", stage: "stopped", message: "예약 실행을 중지했습니다." });
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
      await this.store.updateStatus({ state: "running", stage: "starting", message: "예약을 시작합니다.", startedAt: Date.now() });
      await this.engine.run(config, { prepared: this.prepared });
      return;
    }

    const delay = remaining > HOUR ? HOUR : remaining > PREWARM_MS ? Math.min(remaining - PREWARM_MS, 30_000) : Math.min(remaining, 50);
    this.timer = setTimeout(() => this.tick().catch((error) => this.fail(error)), Math.max(10, delay));
  }

  async fail(error) {
    this.armed = false;
    this.stopTimer();
    await this.engine.close();
    await this.store.updateStatus({ state: "failed", stage: "exception", message: error.message || String(error) });
  }

  stopTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
