import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig, normalizeConfig } from "./config.js";

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.configPath = path.join(dataDir, "reservation-config.json");
    this.statusPath = path.join(dataDir, "reservation-status.json");
    this.historyPath = path.join(dataDir, "reservation-history.json");
    this.logPath = path.join(dataDir, "reservation-log.json");
    this.logQueue = Promise.resolve();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
  }

  async getConfig() {
    const stored = await readJson(this.configPath, null);
    return stored ? normalizeConfig(stored) : defaultConfig();
  }

  async saveConfig(config, { recordHistory = true } = {}) {
    const normalized = normalizeConfig(config);
    await atomicWrite(this.configPath, normalized);
    if (recordHistory) await this.saveHistory(normalized);
    return normalized;
  }

  async mergeDiscoveredRooms(names) {
    const config = await this.getConfig();
    const existing = new Set(config.roomPriority.map((room) => room.name));
    const addedRooms = [];
    for (const value of names) {
      const name = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!name || existing.has(name)) continue;
      existing.add(name);
      addedRooms.push(name);
      config.roomPriority.push({ name, enabled: false });
    }
    if (addedRooms.length) {
      await this.saveConfig(config, { recordHistory: false });
      await this.recordLog("info", "room-detected", `신규 객실 ${addedRooms.length}개를 자동 추가했습니다.`, { rooms: addedRooms }).catch(() => {});
    }
    return { config, addedRooms };
  }

  async listHistory() {
    const entries = await readJson(this.historyPath, []);
    return entries
      .map(({ id, savedAt, config }) => ({
        id,
        savedAt,
        startDate: config.startDate,
        nights: config.nights,
        bookingMode: config.bookingMode,
        useSecondProfile: Boolean(config.useSecondProfile),
        enabledRooms: config.roomPriority.filter((room) => room.enabled).map((room) => room.name)
      }))
      .sort((left, right) => right.savedAt - left.savedAt);
  }

  async getHistory(id) {
    const entries = await readJson(this.historyPath, []);
    return entries.find((entry) => entry.id === id) || null;
  }

  async loadHistory(id) {
    const entry = await this.getHistory(id);
    if (!entry) return null;
    const config = await this.saveConfig(entry.config, { recordHistory: false });
    return { ...entry, config };
  }

  async deleteHistory(id) {
    const entries = await readJson(this.historyPath, []);
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) return false;
    await atomicWrite(this.historyPath, next);
    return true;
  }

  async saveHistory(config) {
    const entries = await readJson(this.historyPath, []);
    const id = historyId(config.startDate, config.nights);
    const entry = { id, savedAt: Date.now(), config };
    const next = [entry, ...entries.filter((item) => item.id !== id)].slice(0, 50);
    await atomicWrite(this.historyPath, next);
  }

  async getStatus() {
    return readJson(this.statusPath, {
      state: "idle",
      stage: "idle",
      message: "예약 설정을 저장한 뒤 대기를 시작하세요.",
      updatedAt: Date.now()
    });
  }

  async updateStatus(patch) {
    const current = await this.getStatus();
    const next = { ...current, ...patch, updatedAt: Date.now() };
    await atomicWrite(this.statusPath, next);
    void this.recordLog(next.state === "failed" ? "error" : "info", "status", next.message || next.stage || next.state, {
      state: next.state,
      stage: next.stage,
      selectedRoom: next.selectedRoom || null,
      selectedRooms: next.selectedRooms || [],
      succeededRooms: next.succeededRooms || [],
      failedRooms: next.failedRooms || [],
      technicalMessage: patch.technicalMessage || null,
      profileStatuses: next.profileStatuses || []
    }).catch(() => {});
    return next;
  }

  async recordLog(level, event, message, details = {}) {
    const entry = { timestamp: Date.now(), level, event, message: String(message || ""), details };
    this.logQueue = this.logQueue.catch(() => {}).then(async () => {
      const entries = await readJson(this.logPath, []);
      entries.push(entry);
      await atomicWrite(this.logPath, entries.slice(-1000));
    });
    await this.logQueue;
    return entry;
  }

  async listLogs(limit = 500) {
    await this.logQueue;
    const entries = await readJson(this.logPath, []);
    return entries.slice(-Math.max(1, Math.min(Number(limit) || 500, 1000))).reverse();
  }
}

function historyId(startDate, nights) {
  return `${startDate}__${nights}`;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicWrite(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}
