import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const MAX_MAP_BYTES = 12 * 1024 * 1024;

export class SiteMap {
  constructor(dataDir, defaultPath) {
    this.file = path.join(dataDir, "site-map.png");
    this.defaultPath = defaultPath;
    this.directory = path.join(dataDir, "site-map-gallery");
    this.manifest = path.join(this.directory, "gallery.json");
    this.queue = Promise.resolve();
  }

  locked(action) {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }

  async state() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { return JSON.parse(await readFile(this.manifest, "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const state = { entries: [], activeId: null };
      try {
        const image = await readFile(this.file);
        const id = randomUUID();
        await writeFile(path.join(this.directory, `${id}.png`), image, { mode: 0o600 });
        state.entries.push({ id, createdAt: Date.now() });
        state.activeId = id;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      await this.persist(state);
      return state;
    }
  }

  async persist(state) {
    const temporary = `${this.manifest}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, this.manifest);
    } finally { await rm(temporary, { force: true }); }
  }

  list() { return this.locked(() => this.state()); }

  readPhoto(id) {
    return this.locked(async () => {
      const state = await this.state();
      if (!state.entries.some(entry => entry.id === id)) throw invalid("사진을 찾을 수 없습니다.", 404);
      return readFile(path.join(this.directory, `${id}.png`));
    });
  }

  select(id) {
    return this.locked(async () => {
      const state = await this.state();
      if (!state.entries.some(entry => entry.id === id)) throw invalid("사진을 찾을 수 없습니다.", 404);
      await readFile(path.join(this.directory, `${id}.png`));
      state.activeId = id;
      await this.persist(state);
      return state;
    });
  }

  remove(ids) {
    return this.locked(async () => {
      const state = await this.state();
      if (!Array.isArray(ids) || !ids.length || ids.some(id => !state.entries.some(entry => entry.id === id))) throw invalid("삭제할 사진을 다시 확인해 주세요.");
      const removed = state.entries.filter(entry => ids.includes(entry.id));
      state.entries = state.entries.filter(entry => !ids.includes(entry.id));
      if (ids.includes(state.activeId)) state.activeId = state.entries.at(-1)?.id || null;
      await this.persist(state);
      for (const entry of removed) await rm(path.join(this.directory, `${entry.id}.png`), { force: true });
      return state;
    });
  }

  async read() {
    return this.locked(async () => {
      const state = await this.state();
      return readFile(state.activeId ? path.join(this.directory, `${state.activeId}.png`) : this.defaultPath);
    });
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
    return this.locked(async () => {
      const state = await this.state();
      if (state.entries.length >= 6) throw invalid("사진은 최대 6개입니다. 필요 없는 사진을 삭제한 뒤 등록해 주세요.", 409);
      const id = randomUUID(), file = path.join(this.directory, `${id}.png`);
      await writeFile(file, image, { mode: 0o600 });
      state.entries.push({ id, createdAt: Date.now() });
      state.activeId = id;
      try { await this.persist(state); }
      catch (error) { await rm(file, { force: true }); throw error; }
      return state;
    });
  }
}

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
