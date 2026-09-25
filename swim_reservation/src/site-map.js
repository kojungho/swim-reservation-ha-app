import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const MAX_MAP_BYTES = 12 * 1024 * 1024;

export class SiteMap {
  constructor(dataDir, defaultPath) {
    this.file = path.join(dataDir, "site-map.png");
    this.defaultPath = defaultPath;
  }

  async read() {
    try { return await readFile(this.file); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      return readFile(this.defaultPath);
    }
  }

  async save(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size <= MAX_MAP_BYTES) chunks.push(chunk);
    }
    if (size > MAX_MAP_BYTES) throw invalid("사진 용량이 너무 큽니다. 더 작은 사진을 선택해 주세요.", 413);
    const image = Buffer.concat(chunks);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (image.length < 45 || !image.subarray(0, 8).equals(signature)
      || image.toString("ascii", 12, 16) !== "IHDR"
      || image.toString("ascii", image.length - 8, image.length - 4) !== "IEND") {
      throw invalid("사진 파일을 확인할 수 없습니다. 사진을 다시 선택해 주세요.");
    }
    const width = image.readUInt32BE(16), height = image.readUInt32BE(20);
    if (!width || !height || width > 2400 || height > 2400) throw invalid("사진 크기가 너무 큽니다.");
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, image, { mode: 0o600 });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
