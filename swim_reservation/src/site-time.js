import { performance } from "node:perf_hooks";

const DEFAULT_URL = "http://newpension.logosweb.or.kr/reservation/reservation1.php?id=swim";
const RESYNC_MS = 5 * 60 * 1000;

export class SiteTimeSync {
  constructor({ url = DEFAULT_URL, fetchImpl = fetch, wallNow = Date.now, monoNow = () => performance.now() } = {}) {
    this.url = url;
    this.fetchImpl = fetchImpl;
    this.wallNow = wallNow;
    this.monoNow = monoNow;
    this.sample = null;
    this.timer = null;
    this.syncing = null;
    this.lastError = null;
  }

  async sync(sampleCount = 3) {
    if (this.syncing) return this.syncing;
    this.syncing = this.measure(sampleCount).finally(() => { this.syncing = null; });
    return this.syncing;
  }

  async measure(sampleCount) {
    const samples = [];
    let lastError;
    for (let index = 0; index < sampleCount; index += 1) {
      try {
        samples.push(await this.measureOnce());
      } catch (error) {
        lastError = error;
      }
    }
    if (!samples.length) {
      this.lastError = lastError?.message || "예약 사이트가 서버 시간을 제공하지 않았습니다.";
      throw new Error(this.lastError);
    }
    samples.sort((left, right) => left.rttMs - right.rttMs);
    this.sample = samples[0];
    this.lastError = null;
    return this.status();
  }

  async measureOnce() {
    const startedWall = this.wallNow();
    const startedMono = this.monoNow();
    const response = await this.fetchImpl(`${this.url}&_time=${startedWall}`, {
      method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(8_000)
    });
    const endedMono = this.monoNow();
    const endedWall = this.wallNow();
    const dateHeader = response.headers.get("date");
    const serverMs = Date.parse(dateHeader || "");
    if (!Number.isFinite(serverMs)) throw new Error("예약 사이트 응답에 Date 헤더가 없습니다.");
    const rttMs = Math.max(0, endedMono - startedMono);
    const midpointWall = startedWall + (endedWall - startedWall) / 2;
    return {
      offsetMs: serverMs - midpointWall,
      rttMs,
      syncedWallMs: endedWall,
      syncedMonoMs: endedMono,
      serverAtSyncMs: endedWall + serverMs - midpointWall,
      precisionMs: 1000
    };
  }

  now() {
    if (!this.sample) return NaN;
    return this.sample.serverAtSyncMs + this.monoNow() - this.sample.syncedMonoMs;
  }

  async ensureSynced() {
    if (!this.sample || this.wallNow() - this.sample.syncedWallMs > RESYNC_MS * 2) await this.sync();
    if (!this.sample) throw new Error("쉼오지 서버 시간 동기화에 실패했습니다.");
    return this.now();
  }

  status() {
    if (!this.sample) return { synced: false, error: this.lastError || "동기화 전" };
    return {
      synced: true,
      serverNowMs: this.now(),
      lastSyncedAt: this.sample.syncedWallMs,
      offsetMs: this.sample.offsetMs,
      rttMs: this.sample.rttMs,
      precisionMs: this.sample.precisionMs,
      stale: this.wallNow() - this.sample.syncedWallMs > RESYNC_MS * 2
    };
  }

  start() {
    this.stop();
    this.timer = setInterval(() => this.sync().catch(() => {}), RESYNC_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
