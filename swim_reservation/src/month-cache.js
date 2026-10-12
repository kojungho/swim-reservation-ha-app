import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { bookingOpenIso } from "./config.js";

export function prefetchMonth(now) {
  const local = new Date(now + 9 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 3, 1)).toISOString().slice(0, 7);
}

// Read-only, one date at a time, independent of the booking engines and browser UI.
export class MonthCache {
  constructor({ dataDir, inspect, now = Date.now, canInspect = () => true, knownRooms = async () => [] }) {
    Object.assign(this, { inspect, now, canInspect, knownRooms });
    this.file = path.join(dataDir, "month-cache.json");
    this.intervalMinutes = 60;
    this.result = null;
    this.finishedAt = 0;
    this.retryAt = 0;
    this.task = null;
    this.closed = false;
    this.writes = Promise.resolve();
  }
  async init() {
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8"));
      if ([0, 10, 30, 60, 180, 360, 1440].includes(saved.intervalMinutes)) this.intervalMinutes = saved.intervalMinutes;
      if (saved.result?.month === prefetchMonth(this.now()) && Array.isArray(saved.result.days)) {
        this.result = saved.result;
        this.finishedAt = Number(saved.finishedAt) || 0;
      }
    } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    return this;
  }
  status() {
    const targetMonth = prefetchMonth(this.now());
    return { targetMonth, intervalMinutes: this.intervalMinutes, running: Boolean(this.task),
      result: this.result?.month === targetMonth ? structuredClone(this.result) : null,
      finishedAt: this.result?.month === targetMonth ? this.finishedAt : 0,
      message: this.message || "", nextAt: this.intervalMinutes ? Math.max(this.retryAt, this.finishedAt + this.intervalMinutes * 60_000) : null };
  }
  persist() {
    const body = JSON.stringify({ intervalMinutes: this.intervalMinutes, result: this.result, finishedAt: this.finishedAt });
    this.writes = this.writes.catch(() => {}).then(async () => {
      await writeFile(`${this.file}.tmp`, body, { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    });
    return this.writes;
  }
  async configure(intervalMinutes) {
    if (![0, 10, 30, 60, 180, 360, 1440].includes(intervalMinutes)) throw new Error("자동 조회 간격을 확인해 주세요.");
    this.intervalMinutes = intervalMinutes;
    if (!intervalMinutes) await this.pause();
    await this.persist();
    return this.status();
  }
  start() {
    this.timer = setInterval(() => { void this.tick(); }, 10_000);
    this.timer.unref?.();
  }
  async tick() {
    if (this.closed) return;
    if (!this.canInspect()) { this.controller?.abort(); return; }
    if (this.task || !this.intervalMinutes || this.now() < this.retryAt) return;
    if (this.result?.month !== prefetchMonth(this.now()) || this.now() >= this.finishedAt + this.intervalMinutes * 60_000) this.refresh();
  }
  refresh() {
    if (this.closed || this.task) return this.status();
    if (!this.canInspect()) { this.message = "예약 준비·실행 중에는 미리 조회를 잠시 쉽니다."; return this.status(); }
    this.controller = new AbortController();
    const signal = this.controller.signal;
    // Abort an active date immediately when bookings take priority, not only between dates.
    const guard = setInterval(() => { if (!this.canInspect() || prefetchMonth(this.now()) !== month) this.controller?.abort(); }, 250);
    guard.unref?.();
    const month = prefetchMonth(this.now());
    this.message = "미리 조회 진행 중";
    this.task = this.scan(month, signal).catch(error => {
      this.message = signal.aborted || error.code === "INSPECTION_BUSY" || error.code === "INSPECTION_CANCELED"
        ? "예약 작업을 우선하여 미리 조회를 중단했습니다. 자동 조회는 나중에 다시 시도합니다."
        : `미리 조회 실패: ${error.message}`;
      this.retryAt = this.now() + 60_000;
    }).finally(() => { clearInterval(guard); this.task = null; this.controller = null; });
    return this.status();
  }
  async scan(month, signal) {
    const names = await this.knownRooms();
    const [year, number] = month.split("-").map(Number);
    let fresh = { month, opensAt: bookingOpenIso(`${month}-01`), beforeOpen: true, roomNames: names, capturedAt: this.now(), days: Array.from({ length: new Date(Date.UTC(year, number, 0)).getUTCDate() }, (_, index) => ({ date: `${month}-${String(index + 1).padStart(2, "0")}`, rooms: names.map(name => ({ name, status: "unknown" })) })) };
    try { fresh = await this.inspect({ month, nowMs: this.now(), knownRooms: names }, signal); }
    catch (error) { if (signal.aborted || error.code === "INSPECTION_BUSY" || error.code === "INSPECTION_CANCELED") throw error; }
    if (fresh.month !== month || !Array.isArray(fresh.days)) throw new Error("요청한 달과 다른 현황입니다.");
    const pending = fresh.days.filter(day => !day.rooms.length || day.rooms.some(room => room.status === "unknown"));
    const old = this.result?.month === month ? this.result : null;
    for (const day of pending) {
      const previous = old?.days.find(item => item.date === day.date);
      if (previous?.rooms.length) {
        for (const room of day.rooms) if (room.status === "unknown") room.status = previous.rooms.find(item => item.name === room.name)?.status || "unknown";
        if (!day.rooms.length) day.rooms = structuredClone(previous.rooms);
        if (previous.capturedAt) day.capturedAt = previous.capturedAt;
      }
    }
    this.result = fresh;
    let completed = 0, failed = 0;
    for (const day of pending) {
      if (signal.aborted || !this.canInspect()) throw Object.assign(new Error("조회 중단"), { code: "INSPECTION_CANCELED" });
      this.result.progressText = `미리 조회 ${completed}/${pending.length}일 · ${day.date}`;
      day.queryState = "checking";
      try {
        const found = await this.inspect({ calendarDate: day.date }, signal);
        if (found.date !== day.date || !found.rooms?.length) throw new Error("요청한 날짜의 객실 현황을 확인하지 못했습니다.");
        day.rooms = found.rooms;
        day.capturedAt = found.capturedAt || this.now();
        if (found.sourceUrl) day.sourceUrl = found.sourceUrl;
        day.queryState = found.rooms.some(room => room.status === "unknown") ? "partial" : "done";
        for (const room of found.rooms) if (!this.result.roomNames.includes(room.name)) this.result.roomNames.push(room.name);
        delete day.error;
      } catch (error) {
        if (signal.aborted || error.code === "INSPECTION_BUSY" || error.code === "INSPECTION_CANCELED") throw error;
        day.queryState = "error"; day.error = error.message; failed++;
      }
      completed++;
      await this.persist();
    }
    this.finishedAt = this.now();
    this.retryAt = 0;
    this.result.capturedAt = this.finishedAt;
    this.result.progressText = `미리 조회 완료${failed ? ` · 조회 실패 ${failed}일` : ""}`;
    this.result.message = "저장된 현황이며 실시간 정보나 선택 박수의 예약 가능 여부를 보장하지 않습니다. 조회 버튼으로 갱신할 수 있습니다.";
    this.message = this.result.progressText;
    await this.persist();
  }
  async pause() { this.controller?.abort(); await this.task; }
  async close() { this.closed = true; clearInterval(this.timer); await this.pause(); await this.writes; }
}
