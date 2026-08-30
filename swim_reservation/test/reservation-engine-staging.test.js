import test from "node:test";
import assert from "node:assert/strict";
import { ReservationEngine } from "../src/reservation-engine.js";

const config = {
  startDate: "2026-11-07",
  nights: 1,
  roomPriority: [{ name: "샘_산맥존", enabled: true }],
  profile: { reserverName: "예약자", depositorName: "입금자", phone: "01012345678", birthDate: "19900101" }
};

test("사전 준비는 예약자 정보 입력 후 최종 제출 직전에 멈춘다", async () => {
  const calls = [];
  const statuses = [];
  const engine = new ReservationEngine({ store: { updateStatus: async (patch) => { statuses.push(patch); } } });
  engine.ensurePage = async () => {};
  engine.page = {
    goto: async () => { calls.push("goto"); },
    waitForLoadState: async () => { calls.push("loaded"); }
  };
  engine.assertReservationDate = async () => { calls.push("date-ok"); };
  engine.selectRoom = async () => "샘_산맥존";
  engine.submitCurrentStep = async () => { calls.push("first-submit"); };
  engine.detectPage = async () => calls.filter((call) => call === "detect").length === 0
    ? (calls.push("detect"), "terms")
    : (calls.push("detect"), "personal");
  engine.acceptTerms = async () => { calls.push("terms-checked"); };
  engine.clickAction = async () => { calls.push("terms-submit"); };
  engine.fillPersonalInfo = async () => { calls.push("personal-filled"); };

  await engine.prepare(config);

  assert.equal(calls.includes("personal-filled"), true);
  assert.equal(calls.filter((call) => call.endsWith("submit")).length, 2);
  assert.equal(statuses.at(-1).stage, "final-ready");
  assert.equal(statuses.at(-1).state, "waiting");
});

test("준비된 실행은 마지막 예약하기만 누르고 완료 화면을 확인한다", async () => {
  const calls = [];
  const statuses = [];
  const engine = new ReservationEngine({ store: { updateStatus: async (patch) => { statuses.push(patch); } } });
  engine.ensurePage = async () => {};
  engine.page = { waitForLoadState: async () => { calls.push("loaded"); } };
  engine.assertReservationDate = async () => { calls.push("date-ok"); };
  engine.detectPage = async () => calls.includes("final-submit") ? "success" : "personal";
  engine.fillPersonalInfo = async () => { calls.push("personal-refreshed"); };
  engine.clickAction = async () => { calls.push("final-submit"); };
  engine.close = async () => { calls.push("closed"); };

  await engine.run(config, { prepared: true });

  assert.deepEqual(calls.filter((call) => call.includes("submit")), ["final-submit"]);
  assert.equal(statuses.some((status) => status.stage === "complete" && status.state === "success"), true);
});

test("최종 결과가 객실 마감이면 다음 우선순위로 처음부터 재시도한다", async () => {
  const calls = [];
  const statuses = [];
  const results = ["personal", "retryable", "terms", "personal", "success"];
  const engine = new ReservationEngine({ store: { updateStatus: async (patch) => { statuses.push(patch); } } });
  engine.selectedRoom = "샘_산맥존";
  engine.ensurePage = async () => {};
  engine.page = { waitForLoadState: async () => {} };
  engine.assertReservationDate = async () => {};
  engine.detectPage = async () => results.shift();
  engine.fillPersonalInfo = async () => {};
  engine.acceptTerms = async () => {};
  engine.clickAction = async () => { calls.push("submit"); };
  engine.startRoomAttempt = async (_config, attempted) => {
    calls.push(`retry:${[...attempted].join(",")}`);
    engine.selectedRoom = "꿈_산맥존";
  };
  engine.close = async () => {};

  await engine.run(config, { prepared: true });

  assert.equal(calls.includes("retry:샘_산맥존"), true);
  assert.equal(statuses.some((status) => status.stage === "retrying-next-room"), true);
  assert.equal(statuses.some((status) => status.state === "success"), true);
});

test("여러 객실 모드는 독립 세션의 최종 제출을 동시에 시작한다", async () => {
  const calls = [];
  const statuses = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const engine = new ReservationEngine({ store: { updateStatus: async (patch) => { statuses.push(patch); } } });
  engine.childSessions = ["샘_산맥존", "꿈_산맥존"].map((room) => ({
    room,
    config: { ...config, bookingMode: "priority" },
    engine: { runSingle: async () => { calls.push(room); await gate; } }
  }));

  const running = engine.runMultiple({ ...config, bookingMode: "multiple" }, { prepared: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.sort(), ["꿈_산맥존", "샘_산맥존"]);
  release();
  await running;

  assert.equal(statuses.some((status) => status.stage === "multiple-final-submit"), true);
  assert.equal(statuses.some((status) => status.stage === "multiple-complete" && status.state === "success"), true);
});

test("여러 객실 사전 준비는 체크한 예약 가능 객실마다 독립 세션을 만든다", async () => {
  const prepared = [];
  const statuses = [];
  const engine = new ReservationEngine({ store: { updateStatus: async (patch) => { statuses.push(patch); } } });
  engine.close = async () => { engine.childSessions = []; };
  engine.inspect = async () => [
    { name: "샘_산맥존", available: true },
    { name: "꿈_산맥존", available: true }
  ];
  engine.createChildSession = (_config, room) => ({
    room,
    status: {},
    config: { ...config, bookingMode: "priority" },
    engine: { prepareSingle: async () => { prepared.push(room); } }
  });
  const multipleConfig = {
    ...config,
    bookingMode: "multiple",
    roomPriority: [
      { name: "샘_산맥존", enabled: true },
      { name: "꿈_산맥존", enabled: true }
    ]
  };

  await engine.prepareMultiple(multipleConfig);

  assert.deepEqual(prepared.sort(), ["꿈_산맥존", "샘_산맥존"]);
  assert.equal(statuses.at(-1).stage, "multiple-final-ready");
  assert.deepEqual(statuses.at(-1).selectedRooms, ["샘_산맥존", "꿈_산맥존"]);
});
