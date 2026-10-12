import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PlanManager, normalizeWatchEndsAt, watchDeadlineAt } from "../src/plan-manager.js";
import { ReservationEngine } from "../src/reservation-engine.js";

const config = { startDate: "2030-11-07", nights: 2, bookingMode: "priority", profiles: [{ reserverName: "테스트", depositorName: "테스트", phone: "01012345678", birthDate: "19900101" }], roomPriority: [{ name: "해_하늘존", enabled: true }] };
const rooms = [{ name: "해_하늘존", status: "available", available: true }];
async function fixture(t, initial = "2030-11-06T23:59:59+09:00") {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "swim-watch-deadline-"));
  let now = Date.parse(initial), reads = 0, booked = 0;
  const timeSync = { now: () => now, ensureSynced: async () => now };
  const engineFactory = store => ({ close: async () => {}, run: async (input, options) => { await options.beforeSubmit?.(); booked++; await store.updateStatus({ state: "success", stage: "complete", message: "테스트 완료" }); } });
  const manager = new PlanManager({ dataDir, timeSync, engineFactory, inspect: async () => { reads++; return []; } });
  manager.schedule = () => {};
  await manager.init();
  t.after(async () => { await manager.close(); await rm(dataDir, { recursive: true, force: true }); });
  return { manager, dataDir, timeSync, engineFactory, setNow: value => { now = Date.parse(value); }, reads: () => reads, booked: () => booked };
}
async function waitStatus(plan, state) {
  for (let index = 0; index < 200; index++) {
    const status = await plan.store.getStatus();
    if (status.state === state) return status;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`상태 ${state}를 기다리는 중 시간 초과`);
}

test("기본 감시 마감은 숙박 시작일 00시이며 당일 조회·예약은 하지 않는다", async t => {
  const app = await fixture(t);
  const id = await app.manager.add({ kind: "watch", config });
  const plan = app.manager.get(id);
  assert.equal(watchDeadlineAt(plan), "2030-11-07T00:00:00");
  await app.manager.start(id);
  await app.manager.poll(plan);
  assert.equal(app.reads(), 1);
  app.setNow("2030-11-07T00:00:00+09:00");
  await app.manager.poll(plan);
  assert.equal(app.reads(), 1);
  assert.equal(app.booked(), 0);
  assert.equal(plan.enabled, false);
  assert.equal((await plan.store.getStatus()).stage, "expired");
  await app.manager.start(id);
  assert.equal(plan.enabled, false);
});

test("직접 지정한 마감이 기본값보다 우선하여 숙박 당일 감시·예약을 허용한다", async t => {
  const app = await fixture(t, "2030-11-07T12:00:00+09:00");
  app.manager.inspect = async () => rooms;
  const id = await app.manager.add({ kind: "watch", config, watchEndsAt: "2030-11-07T18:00" });
  assert.equal((await app.manager.list())[0].watchDeadlineAt, "2030-11-07T18:00:00");
  await app.manager.start(id);
  await app.manager.poll(app.manager.get(id));
  await waitStatus(app.manager.get(id), "success");
  assert.equal(app.booked(), 1);
});

test("마감 설정은 재시작 후 유지되고 더 이른 마감·정확한 경계 시각에도 종료한다", async t => {
  const app = await fixture(t, "2030-11-06T19:00:00+09:00");
  const id = await app.manager.add({ kind: "watch", config, watchEndsAt: "2030-11-06T20:00:00" });
  await app.manager.start(id);
  await app.manager.close();
  const restored = new PlanManager({ dataDir: app.dataDir, timeSync: app.timeSync, engineFactory: app.engineFactory, inspect: async () => rooms });
  restored.schedule = () => {};
  t.after(() => restored.close());
  await restored.init();
  assert.equal((await restored.list())[0].watchEndsAt, "2030-11-06T20:00:00");
  app.setNow("2030-11-06T20:00:00+09:00");
  await restored.poll(restored.get(id));
  assert.equal(restored.get(id).enabled, false);
  assert.equal((await restored.get(id).store.getStatus()).stage, "expired");
  assert.equal(app.booked(), 0);
});

test("조회 도중 마감이 지나면 가능 객실이 반환되어도 예약하지 않는다", async t => {
  const app = await fixture(t);
  app.manager.inspect = async () => { app.setNow("2030-11-07T00:00:00+09:00"); return rooms; };
  const id = await app.manager.add({ kind: "watch", config });
  await app.manager.start(id);
  await app.manager.poll(app.manager.get(id));
  assert.equal(app.booked(), 0);
  assert.equal(app.manager.get(id).enabled, false);
});

test("최종 제출 직전과 버튼 탐색 후에 마감을 다시 검사하고 예약 오류가 아닌 종료로 표시한다", async () => {
  for (const prepared of [true, false]) {
    let clicked = 0, diagnostics = 0;
    const status = {};
    const expired = () => { const error = new Error("감시 마감"); error.code = "WATCH_DEADLINE"; throw error; };
    const engine = new ReservationEngine({ store: { updateStatus: async patch => Object.assign(status, patch) } });
    engine.page = { waitForLoadState: async () => {} };
    engine.ensurePage = async () => {};
    engine.startRoomAttempt = async () => {};
    engine.assertReservationDate = async () => {};
    engine.detectPage = async () => "personal";
    engine.fillPersonalInfo = async () => {};
    engine.close = async () => {};
    engine.collectDiagnostics = async () => { diagnostics++; return {}; };
    engine.clickAction = async () => { clicked++; };
    await assert.rejects(engine.runSingle(config, { prepared, beforeSubmit: expired }), { code: "WATCH_DEADLINE" });
    assert.equal(clicked, 0);
    assert.equal(diagnostics, 0);
    assert.equal(status.state, "stopped");
    assert.equal(status.stage, "expired");
  }
  let clicked = 0, located = false;
  const item = { evaluate: async () => { located = true; return "예약하기"; }, click: async () => { clicked++; } };
  const engine = new ReservationEngine({ store: {} });
  engine.page = { url: () => "about:blank", locator: () => ({ count: async () => 1, nth: () => item }) };
  await assert.rejects(engine.clickAction(["예약하기"], true, () => { assert.equal(located, true); const error = new Error("감시 마감"); error.code = "WATCH_DEADLINE"; throw error; }), { code: "WATCH_DEADLINE" });
  assert.equal(clicked, 0);
});

test("잘못된 감시 마감 날짜는 저장하지 않고 공백은 기본 마감으로 처리한다", () => {
  assert.equal(normalizeWatchEndsAt(undefined), "");
  assert.equal(normalizeWatchEndsAt(""), "");
  assert.equal(normalizeWatchEndsAt("2030-11-07T18:00"), "2030-11-07T18:00:00");
  for (const value of ["2030-02-30T12:00", "2030-11-07T24:00", "잘못된 날짜", 123]) assert.throws(() => normalizeWatchEndsAt(value), /감시 마감/);
});
