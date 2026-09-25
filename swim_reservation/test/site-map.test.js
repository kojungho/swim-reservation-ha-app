import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { SiteMap, MAX_MAP_BYTES } from "../src/site-map.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=", "base64");

test("등록한 안내 사진은 재시작 후에도 유지되고 실패한 업로드는 기존 사진을 보존한다", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "swim-map-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const defaultPath = path.join(dir, "default.png");
  await writeFile(defaultPath, "default");
  const map = new SiteMap(dir, defaultPath);
  assert.equal((await map.read()).toString(), "default");
  await map.save(Readable.from([png]));
  assert.deepEqual(await new SiteMap(dir, defaultPath).read(), png);
  await assert.rejects(map.save(Readable.from([Buffer.from("<svg></svg>")])), { statusCode: 400 });
  await assert.rejects(map.save(Readable.from([Buffer.alloc(MAX_MAP_BYTES + 1)])), { statusCode: 413 });
  assert.deepEqual(await map.read(), png);
});
