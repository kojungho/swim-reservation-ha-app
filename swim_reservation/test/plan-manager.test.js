import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PlanManager, matchWatchRooms, watchConfiguration } from "../src/plan-manager.js";
import { defaultConfig } from "../src/config.js";

const profile = { reserverName: "테스트", depositorName: "테스트", phone: "01012345678", birthDate: "19900101" };
function config(mode = "priority") {
  return { ...defaultConfig(), startDate: "2030-10-20", nights: 2, triggerAt: "2030-10-13T00:00:00", bookingMode: mode, profiles: [profile], roomPriority: [{ name: "해_하늘존", enabled: true }, { name: "샘_산맥존", enabled: true }] };
}
const found = [{ name: "해_하늘존", status: "available", available: true }, { name: "샘_산맥존", status: "booked", available: false }];
async function fixture(t, inspect = async () => found) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "swim-plans-test-"));
  const calls = [];
  const now = Date.parse("2030-10-12T12:00:00+09:00");
  const manager = new PlanManager({ dataDir, timeSync: { now: () => now, ensureSynced: async () => now }, inspect,
    engineFactory: store => ({ close: async () => {}, prepare: async () => {}, run: async input => { calls.push(input); await store.updateStatus({ state: "success", stage: "complete", message: "테스트 완료" }); } }) });
  manager.schedule = () => {};
  await manager.init();
  t.after(async () => { await manager.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { manager, calls, dataDir };
}
test("다른 날짜와 모드의 일정은 독립 설정·상태로 동시에 대기하고 한 일정 중지가 다른 일정에 영향을 주지 않는다", async t => {
  const { manager } = await fixture(t);
  const original = config();
  const first = await manager.add({ kind: "scheduled", config: original });
  original.startDate = "2030-10-21";
  const second = await manager.add({ kind: "scheduled", config: { ...original, bookingMode: "multiple" } });
  await Promise.all([manager.start(first), manager.start(second)]);
  assert.equal((await manager.get(first).store.getConfig()).startDate, "2030-10-20");
  assert.equal(manager.get(second).config.bookingMode, "multiple");
  await assert.rejects(manager.start(first), /진행 중/);
  await manager.stop(first);
  assert.equal(manager.get(first).scheduler.armed, false);
  assert.equal(manager.get(second).scheduler.armed, true);
});
test("취소 자리 감시는 박수와 날짜 설정으로 조회하고 가능 객실이 나오면 한 번 예약 후 종료한다", async t => {
  let available = false, inspected;
  const { manager, calls } = await fixture(t, async input => { inspected = input; return available ? found : found.map(room => ({ ...room, available: false, status: "booked" })); });
  const id = await manager.add({ kind: "watch", intervalSeconds: 1, config: config() });
  await manager.start(id);
  const plan = manager.get(id);
  assert.equal(plan.intervalSeconds, 60);
  await manager.poll(plan);
  assert.equal(calls.length, 0);
  assert.equal(inspected.nights, 2);
  assert.equal(inspected.startDate, "2030-10-20");
  available = true;
  await manager.poll(plan);
  while (plan.scheduler.running) await new Promise(resolve => setImmediate(resolve));
  await manager.poll(plan);
  assert.equal(calls.length, 1);
  assert.equal(plan.enabled, false);
  await assert.rejects(manager.start(id), /완료|확인/);
  await manager.stop(id);
  assert.equal((await plan.store.getStatus()).state, "success");
});
test("취소 자리 조회 중 중지하면 늦게 도착한 가능 결과로 예약을 실행하지 않는다", async t => {
  let release;
  const { manager, calls } = await fixture(t, () => new Promise(resolve => { release = resolve; }));
  const id = await manager.add({ kind: "watch", config: config() });
  await manager.start(id);
  const poll = manager.poll(manager.get(id));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await manager.stop(id);
  release(found);
  await poll;
  assert.equal(calls.length, 0);
  assert.equal(manager.get(id).enabled, false);
});
test("재시작 전 실행 중인 일정은 확인 필요로 중지하고 자동 재제출하지 않는다", async t => {
  const { manager, calls } = await fixture(t);
  const id = await manager.add({ kind: "watch", config: config() });
  await manager.start(id);
  await manager.get(id).store.updateStatus({ state: "running", stage: "final-submit" });
  await manager.close();
  manager.closed = false;
  manager.plans.clear();
  await manager.init();
  assert.equal(manager.get(id).enabled, false);
  assert.equal((await manager.get(id).store.getStatus()).stage, "review-required");
  assert.equal(calls.length, 0);
});
test("조회 실패·오픈 전·다른 박수 불가에서는 예약하지 않는다", async t => {
  const { manager, calls } = await fixture(t, async () => { throw new Error("날짜 확인 실패"); });
  const id = await manager.add({ kind: "watch", config: config() });
  await manager.start(id);
  await manager.poll(manager.get(id));
  assert.equal(calls.length, 0);
  assert.equal((await manager.get(id).store.getStatus()).stage, "watch-read-error");
  assert.equal(matchWatchRooms(config(), found.map(room => ({ ...room, available: true, status: "unavailable" }))), false);
});
test("여러 객실 감시는 모든 객실의 박수 조건을 요구하며 미확인·예약 대기를 가능으로 취급하지 않는다", () => {
  assert.equal(matchWatchRooms(config("multiple"), found), false);
  assert.equal(matchWatchRooms(config("multiple"), found.map(room => ({ ...room, status: "available", available: true }))), true);
  assert.equal(matchWatchRooms(config(), found.map(room => ({ ...room, status: "pending", available: true }))), false);
});
test("예약자별 감시는 서로 다른 가능 객실을 확보할 때만 시작하며 배정된 객실을 먼저 시도한다", () => {
  const input = { ...config("profiles-parallel"), profiles: [{ ...profile, roomPriority: config().roomPriority }, { ...profile, roomPriority: config().roomPriority }] };
  assert.equal(matchWatchRooms(input, found), false);
  const matched = watchConfiguration(input, found.map(room => ({ ...room, available: true, status: "available" })));
  assert.ok(matched);
  assert.notEqual(matched.profiles[0].roomPriority[0].name, matched.profiles[1].roomPriority[0].name);
  assert.equal(input.profiles[0].roomPriority[0].name, "해_하늘존");
});
test("예약 대기 이후 편집 설정이 바뀌어도 최초 등록한 날짜와 모드로 실행한다", async t => {
  const { manager, calls } = await fixture(t);
  const id = await manager.add({ kind: "scheduled", config: config() });
  await manager.start(id);
  const plan = manager.get(id);
  plan.scheduler.stopTimer();
  await plan.store.saveConfig({ ...config("multiple"), startDate: "2030-10-21" }, { recordHistory: false });
  manager.timeSync.now = () => Date.parse("2030-10-13T00:00:01+09:00");
  await plan.scheduler.tick();
  assert.equal(calls[0].startDate, "2030-10-20");
  assert.equal(calls[0].bookingMode, "priority");
});
test("서버 시간 동기화 중 실행을 중지하면 동기화 완료 후에도 최종 실행하지 않는다", async t => {
  const { manager, calls } = await fixture(t);
  const id = await manager.add({ kind: "now", config: config() });
  const scheduler = manager.get(id).scheduler;
  let release;
  scheduler.timeSync.ensureSynced = () => new Promise(resolve => { release = resolve; });
  const running = scheduler.runNow({ ...config(), triggerAt: "2030-08-01T00:00:00" });
  await scheduler.stop();
  release(Date.parse("2030-10-12T12:00:00+09:00"));
  await running;
  assert.equal(calls.length, 0);
});
test("오픈 전에는 사이트를 조회하지 않으며 숙박 날짜가 지나면 감시를 종료한다", async t => {
  let reads = 0;
  const { manager, calls } = await fixture(t, async () => { reads++; return found; });
  const future = await manager.add({ kind: "watch", config: { ...config(), startDate: "2031-01-05" } });
  await manager.start(future);
  await manager.poll(manager.get(future));
  assert.equal(reads, 0);
  assert.equal((await manager.get(future).store.getStatus()).stage, "watch-before-open");
  const expired = await manager.add({ kind: "watch", config: { ...config(), startDate: "2030-10-01" } });
  await manager.start(expired);
  await manager.poll(manager.get(expired));
  assert.equal(manager.get(expired).enabled, false);
  assert.equal((await manager.get(expired).store.getStatus()).stage, "expired");
  assert.equal(calls.length, 0);
});
test("동시 진행 5개 제한·진행 중 삭제 제한·안전한 감시 대기 복원을 적용한다", async t => {
  const { manager, calls } = await fixture(t);
  const ids = [];
  for (let index = 0; index < 6; index++) ids.push(await manager.add({ kind: "watch", config: config() }));
  for (const id of ids.slice(0, 5)) await manager.start(id);
  await assert.rejects(manager.start(ids[5]), /최대 5개/);
  await assert.rejects(manager.remove(ids[0]), /중지/);
  await manager.close();
  manager.closed = false;
  manager.plans.clear();
  await manager.init();
  assert.equal(manager.get(ids[0]).enabled, true);
  assert.equal(calls.length, 0);
  await manager.stop(ids[0]);
  await manager.remove(ids[0]);
  assert.equal(manager.plans.has(ids[0]), false);
});
