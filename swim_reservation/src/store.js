import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig, normalizeConfig } from "./config.js";

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.configPath = path.join(dataDir, "reservation-config.json");
    this.statusPath = path.join(dataDir, "reservation-status.json");
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
  }

  async getConfig() {
    const stored = await readJson(this.configPath, null);
    return stored ? normalizeConfig(stored) : defaultConfig();
  }

  async saveConfig(config) {
    const normalized = normalizeConfig(config);
    await atomicWrite(this.configPath, normalized);
    return normalized;
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
