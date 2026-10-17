import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_UI_SETTINGS = {
  fonts: { title: 28, heading: 18, body: 14, field: 16, button: 13, room: 14, status: 12, calendar: 12, list: 14, log: 12 },
  serverTime: true, reservationInfo: true, safety: true, watchInfo: true, stayRange: false,
  menuCorner: "top-right", mapCorner: "bottom-right", menuSpacing: 6, mapIcon: true, floatingSize: 46
};
export function normalizeUiSettings(input = {}) {
  const result = structuredClone(DEFAULT_UI_SETTINGS);
  for (const key of Object.keys(result.fonts)) {
    const value = input.fonts?.[key];
    if (value !== undefined) {
      if (!Number.isInteger(value) || value < 10 || value > (key === "title" ? 42 : 24)) throw new Error("글자 크기는 허용 범위의 정수로 입력해 주세요.");
      result.fonts[key] = value;
    }
  }
  for (const key of ["serverTime", "reservationInfo", "safety", "watchInfo", "stayRange", "mapIcon"]) {
    if (input[key] !== undefined) { if (typeof input[key] !== "boolean") throw new Error("표시 설정을 확인해 주세요."); result[key] = input[key]; }
  }
  for (const key of ["menuCorner", "mapCorner"]) {
    if (input[key] !== undefined) { if (!["top-left", "top-right", "bottom-left", "bottom-right"].includes(input[key])) throw new Error("버튼 위치를 확인해 주세요."); result[key] = input[key]; }
  }
  if (input.menuSpacing !== undefined) {
    if (!Number.isInteger(input.menuSpacing) || input.menuSpacing < 0 || input.menuSpacing > 16) throw new Error("메뉴 간격은 0~16으로 입력해 주세요.");
    result.menuSpacing = input.menuSpacing;
  }
  if (input.floatingSize !== undefined) {
    if (!Number.isInteger(input.floatingSize) || input.floatingSize < 44 || input.floatingSize > 64) throw new Error("플로팅 크기는 44~64px의 정수로 입력해 주세요.");
    result.floatingSize = input.floatingSize;
  }
  return result;
}
export class UiSettings {
  constructor(dataDir) { this.file = path.join(dataDir, "ui-settings.json"); this.queue = Promise.resolve(); }
  async read() {
    try { return normalizeUiSettings(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; return structuredClone(DEFAULT_UI_SETTINGS); }
  }
  save(input) {
    const settings = normalizeUiSettings(input);
    const result = this.queue.then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(settings), { mode: 0o600 }); await rename(temporary, this.file); }
      finally { await rm(temporary, { force: true }); }
      return settings;
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
