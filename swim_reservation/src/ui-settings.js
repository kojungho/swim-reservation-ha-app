import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_UI_SETTINGS = {
  addonMenus: {priority:true,multiple:true,"profiles-parallel":true,watch:true},
  appMenus: {priority:true,multiple:true,"profiles-parallel":true,watch:true,book:true,people:true,monthly:true,logs:true},
  appMenuLabels: {priority:"단독 예약",multiple:"다중 예약","profiles-parallel":"다인 예약",watch:"취소 대기"},
  fonts: { title: 28, heading: 18, body: 14, field: 16, button: 13, room: 14, status: 12, calendar: 12, list: 14, log: 12 },
  serverTime: true, reservationInfo: true, safety: true, watchInfo: true, stayRange: true, dateInputVersion: 1,
  menuCorner: "top-right", mapCorner: "bottom-right", menuSpacing: 6, mapIcon: true, floatingSize: 46
};
export function normalizeUiSettings(input = {}) {
  const result = structuredClone(DEFAULT_UI_SETTINGS);
  if(input.appMenuLabels!==undefined){if(!input.appMenuLabels||Array.isArray(input.appMenuLabels)||typeof input.appMenuLabels!=="object")throw new Error("앱 메뉴 이름을 확인하세요.");for(const key of Object.keys(result.appMenuLabels))if(input.appMenuLabels[key]!==undefined){const name=input.appMenuLabels[key];if(typeof name!=="string"||!name.trim()||name.trim().length>20||/[\u0000-\u001f\u007f]/.test(name))throw new Error("앱 메뉴 이름은 1~20자로 입력하세요.");result.appMenuLabels[key]=name.trim();}}
  for(const target of ["addonMenus","appMenus"])if(input[target]!==undefined){if(!input[target]||Array.isArray(input[target])||typeof input[target]!=="object")throw new Error("메뉴 표시 설정을 확인하세요.");for(const key of Object.keys(result[target]))if(input[target][key]!==undefined){if(typeof input[target][key]!=="boolean")throw new Error("메뉴 표시 설정을 확인하세요.");result[target][key]=input[target][key];}}
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
  if(input.dateInputVersion!==undefined&&input.dateInputVersion!==0&&input.dateInputVersion!==1)throw new Error("날짜 표시 설정 버전을 확인해 주세요.");
  // Old add-on files defaulted to nights-only. Migrate once; later explicit choices survive.
  if(input.dateInputVersion!==1)result.stayRange=true;
  result.dateInputVersion=1;
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
