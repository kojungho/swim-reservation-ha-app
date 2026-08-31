import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig, normalizeConfig } from "./config.js";

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.configPath = path.join(dataDir, "reservation-config.json");
    this.statusPath = path.join(dataDir, "reservation-status.json");
    this.historyPath = path.join(dataDir, "reservation-history.json");
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
    return next;
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
