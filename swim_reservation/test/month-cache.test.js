import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MonthCache, prefetchMonth } from "../src/month-cache.js";

test("3개월 뒤만 미리 조회·저장·복원하고 수동 갱신과 간격 변경을 지원한다", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "swim-month-cache-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let now = Date.parse("2026-10-12T00:00:00+09:00");
  const calls = [];
  const options = { dataDir, now: () => now, knownRooms: async () => ["해"], inspect: async config => {
    calls.push(config);
    if (config.month) throw new Error("월별 미제공");
    return { date: config.calendarDate, rooms: [{ name: "해", status: "available" }], capturedAt: now };
  } };
  const cache = await new MonthCache(options).init();
  await cache.tick(); await cache.task;
  assert.equal(cache.status().targetMonth, "2027-01");
  assert.equal(calls.length, 32);
  assert.equal(cache.status().result.days.length, 31);
  assert.ok(calls.every(item => item.month === "2027-01" || item.calendarDate.startsWith("2027-01-")));
  await cache.tick(); assert.equal(calls.length, 32);
  const restored = await new MonthCache(options).init();
  assert.deepEqual(restored.status().result, cache.status().result);
  await restored.configure(0); await restored.tick(); assert.equal(calls.length, 32);
  restored.refresh(); const job = restored.task; restored.refresh(); assert.equal(restored.task, job);
  await job; assert.equal(calls.length, 64);
  await assert.rejects(restored.configure(1), /간격/);
  now = Date.parse("2026-11-01T00:00:00+09:00");
  assert.equal(restored.status().targetMonth, "2027-02"); assert.equal(restored.status().result, null);
  await restored.configure(10); await restored.tick(); await restored.task;
  assert.equal(restored.status().result.days.length, 28);
  await cache.close(); await restored.close();
});

test("예약 작업을 우선하며 조회 날짜 불일치·실패를 예약 가능으로 저장하지 않는다", async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "swim-month-cache-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let safe = false;
  const cache = await new MonthCache({ dataDir, canInspect: () => safe, now: () => Date.parse("2026-10-12T00:00:00+09:00"), knownRooms: async () => ["해"], inspect: async config => {
    if (config.month) throw new Error("미제공");
    return { date: "2027-02-01", rooms: [{ name: "해", status: "available" }] };
  } }).init();
  cache.refresh(); assert.equal(cache.task, null);
  safe = true; cache.refresh(); await cache.task;
  assert.ok(cache.status().result.days.every(day => day.queryState === "error" && day.rooms[0].status === "unknown"));
  cache.inspect = async (config, signal) => {
    if (config.month) throw new Error("미제공");
    safe = false;
    await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
    throw Object.assign(new Error("중지"), { code: "INSPECTION_CANCELED" });
  };
  cache.refresh(); await cache.task;
  assert.match(cache.status().message, /우선/);
  await cache.close();
});

test("한국 월 경계·연말 기준으로 미리 조회 대상이 바뀐다", () => {
  assert.equal(prefetchMonth(Date.parse("2026-10-31T15:00:00Z")), "2027-02");
  assert.equal(prefetchMonth(Date.parse("2026-10-31T14:59:59Z")), "2027-01");
});
