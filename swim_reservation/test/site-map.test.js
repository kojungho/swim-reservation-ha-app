import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
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

test("사진 이력은 기존 사진을 보존하고 최대 6개·확대·적용·선택 삭제·전체 삭제와 재시작을 지원한다", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "swim-gallery-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const fallback = path.join(dir, "default.png"); await writeFile(fallback, "default");
  await writeFile(path.join(dir, "site-map.png"), png);
  const map = new SiteMap(dir, fallback);
  const migrated = await map.list(); assert.equal(migrated.entries.length, 1);
  const firstId = migrated.activeId;
  await Promise.all(Array.from({ length: 5 }, () => map.save(Readable.from([png]))));
  const full = await map.list(); assert.equal(full.entries.length, 6);
  await assert.rejects(map.save(Readable.from([png])), { statusCode: 409 });
  assert.deepEqual(await map.list(), full);
  assert.deepEqual(await map.readPhoto(firstId), png);
  assert.equal((await stat(path.join(map.directory, `${firstId}.png`))).mode & 0o777, 0o600);
  await map.select(firstId);
  const restarted = new SiteMap(dir, fallback); assert.equal((await restarted.list()).activeId, firstId);
  await assert.rejects(map.remove(["../../default"]), { statusCode: 400 });
  await assert.rejects(map.select("../../default"), { statusCode: 404 });
  await assert.rejects(map.readPhoto("../../default"), { statusCode: 404 });
  const remaining = await restarted.remove([firstId, full.entries[1].id]); assert.equal(remaining.entries.length, 4); assert.equal(remaining.activeId, full.entries.at(-1).id);
  await assert.rejects(map.readPhoto(firstId), { statusCode: 404 });
  await restarted.remove(remaining.entries.map(entry => entry.id));
  assert.deepEqual(await new SiteMap(dir, fallback).list(), { entries: [], activeId: null });
  assert.equal((await new SiteMap(dir, fallback).read()).toString(), "default");
  await restarted.save(Readable.from([png])); assert.equal((await restarted.list()).entries.length, 1);
});
