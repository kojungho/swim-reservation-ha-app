import test from "node:test";
import assert from "node:assert/strict";
import { InspectionService } from "../src/inspection-service.js";

const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const engines = [];
  const service = new InspectionService(() => {
    const engine = {
      closed: false,
      ensurePage: async () => {},
      inspect: config => new Promise((resolve, reject) => {
        engine.finish = () => resolve([config.startDate]);
        engine.page = { close: async () => reject(new Error("Target page closed")) };
      }),
      close: async () => { engine.closed = true; }
    };
    engines.push(engine);
    return engine;
  });
  return { service, engines };
}

test("동시 날짜 조회는 분리된 엔진에서 순서대로 완료된다", async () => {
  const { service, engines } = fixture();
  const config = { startDate: "2026-12-04" };
  const first = service.inspect(config);
  config.startDate = "2026-12-11";
  const second = service.inspect(config);
  await turn();
  assert.equal(engines.length, 1);
  engines[0].finish();
  assert.deepEqual(await first, ["2026-12-04"]);
  await turn();
  assert.equal(engines[0].closed, true);
  assert.equal(engines.length, 2);
  engines[1].finish();
  assert.deepEqual(await second, ["2026-12-11"]);
  assert.equal(engines[1].closed, true);
});

test("진행 중 조회 취소 뒤 다음 조회는 정상 실행된다", async () => {
  const { service, engines } = fixture();
  const controller = new AbortController();
  const first = service.inspect({ startDate: "2026-12-04" }, controller.signal);
  const rejected = assert.rejects(first, { code: "INSPECTION_CANCELED" });
  const second = service.inspect({ startDate: "2026-12-11" });
  await turn();
  controller.abort();
  await rejected;
  await turn();
  engines[1].finish();
  assert.deepEqual(await second, ["2026-12-11"]);
});

test("중지는 진행 중 조회와 대기 조회를 모두 취소한다", async () => {
  const { service, engines } = fixture();
  const first = assert.rejects(service.inspect({}), { code: "INSPECTION_CANCELED" });
  const second = assert.rejects(service.inspect({}), { code: "INSPECTION_CANCELED" });
  await turn();
  await service.cancelAll();
  await Promise.all([first, second]);
  assert.equal(engines.length, 1);
  assert.equal(engines[0].closed, true);
});

test("대기 중 예약 준비가 시작되면 조회 엔진을 생성하지 않는다", async () => {
  let created = false;
  const service = new InspectionService(() => { created = true; }, () => false);
  await assert.rejects(service.inspect({}), { code: "INSPECTION_BUSY" });
  assert.equal(created, false);
});
