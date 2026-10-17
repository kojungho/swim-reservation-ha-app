import { readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function normalizeSubmissionSettings(input = {}) {
  const intervalSeconds = input.intervalSeconds ?? 5;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 0 || intervalSeconds > 60) throw new Error("최종 제출 간격은 0~60초 정수로 입력해 주세요. 0은 지연 미사용입니다.");
  return { intervalSeconds };
}
export class SubmissionSettings {
  constructor(dataDir) { this.file = path.join(dataDir, "submission-settings.json"); this.queue = Promise.resolve(); }
  async read() {
    try { return normalizeSubmissionSettings(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; return normalizeSubmissionSettings(); }
  }
  save(input) {
    const settings = normalizeSubmissionSettings(input);
    const result = this.queue.then(async () => {
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(settings), { mode: 0o600 }); await rename(temporary, this.file); }
      finally { await rm(temporary, { force: true }); }
      return settings;
    });
    this.queue = result.catch(() => {}); return result;
  }
}
