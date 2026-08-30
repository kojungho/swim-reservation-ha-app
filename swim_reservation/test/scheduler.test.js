import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../src/scheduler.js";

test("즉시 예약은 대기 타이머 없이 엔진을 실행한다", async () => {
  const statuses = [];
  const calls = [];
  const store = {
    updateStatus: async (patch) => { statuses.push(patch); return patch; },
    getStatus: async () => ({ state: "idle" }),
    getConfig: async () => ({})
  };
  const engine = {
    run: async (config, options) => { calls.push({ config, options }); },
    close: async () => {}
  };
  const scheduler = new Scheduler({ store, engine });
  const config = { startDate: "2026-10-22" };

  await scheduler.runNow(config);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(statuses[0].state, "running");
  assert.equal(statuses[0].stage, "starting-now");
  assert.deepEqual(calls, [{ config, options: { prepared: false } }]);
  assert.equal(scheduler.running, false);
});

test("실행 중인 예약 엔진을 중복 실행하지 않는다", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const store = { updateStatus: async (patch) => patch };
  const engine = { run: async () => gate, close: async () => {} };
  const scheduler = new Scheduler({ store, engine });

  await scheduler.runNow({});
  await assert.rejects(() => scheduler.runNow({}), /이미 예약 엔진이 실행 중/);
  release();
  await new Promise((resolve) => setImmediate(resolve));
});
