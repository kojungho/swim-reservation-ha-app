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

  await engine.prepareSingle(config);

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

test("예약자 1 성공 확인 후에만 예약자 2를 순차 실행하고 정보가 섞이지 않는다", async () => {
  const calls = [];
  const statuses = [];
  const engine = new ReservationEngine({ store: { updateStatus: async (patch) => { statuses.push(structuredClone(patch)); } } });
  const twoProfiles = {
    ...config,
    useSecondProfile: true,
    profile1: { ...config.profile, reserverName: "예약자1" },
    profile2: { ...config.profile, reserverName: "예약자2" }
  };
  engine.prioritySessions = [0, 1].map((profileIndex) => ({
    profileIndex, status: {}, config: { ...twoProfiles, profile: profileIndex ? twoProfiles.profile2 : twoProfiles.profile1 },
    engine: {
      runSingle: async (sessionConfig) => { calls.push(sessionConfig.profile.reserverName); return { room: "샘_산맥존" }; },
      close: async () => {}
    }
  }));

  await engine.runUnpreparedProfiles(twoProfiles);

  assert.deepEqual(calls, ["예약자1", "예약자2"]);
  assert.equal(statuses.at(-1).stage, "profiles-complete");
  assert.deepEqual(statuses.at(-1).profileStatuses.map((item) => item.state), ["예약 완료", "예약 완료"]);
});

test("예약자 1 실패 시 예약자 2를 실행하지 않는다", async () => {
  const calls = [];
  const engine = new ReservationEngine({ store: { updateStatus: async () => {} } });
  const twoProfiles = { ...config, useSecondProfile: true, profile1: config.profile, profile2: { ...config.profile, reserverName: "예약자2" } };
  engine.prioritySessions = [
    { profileIndex: 0, status: {}, config: twoProfiles, engine: { runSingle: async () => { calls.push("예약자1"); throw new Error("모든 순위 실패"); }, close: async () => {} } },
    { profileIndex: 1, status: {}, config: twoProfiles, engine: { runSingle: async () => { calls.push("예약자2"); }, close: async () => {} } }
  ];

  await assert.rejects(() => engine.runUnpreparedProfiles(twoProfiles), /모든 순위 실패/);
  assert.deepEqual(calls, ["예약자1"]);
});

test("각 예약자는 1순위 실패 후 2순위를 시도하며 성공 뒤 다음 순위를 중단한다", async () => {
  const calls = [];
  const engine = new ReservationEngine({ store: { updateStatus: async () => {} } });
  const twoProfiles = { ...config, useSecondProfile: true, profile1: config.profile, profile2: { ...config.profile, reserverName: "예약자2" } };
  const make = (profileIndex, rank, succeeds) => ({
    profileIndex, rank, room: `${rank}순위객실`, config: twoProfiles,
    engine: {
      runSingle: async () => {
        calls.push(`${profileIndex + 1}-${rank}`);
        if (!succeeds) { const error = new Error("객실 마감"); error.code = "ROOM_UNAVAILABLE"; throw error; }
        return { room: `${rank}순위객실` };
      },
      close: async () => {}
    }
  });
  engine.prioritySessions = [make(0, 1, false), make(0, 2, true), make(0, 3, true), make(1, 1, false), make(1, 2, true)];

  await engine.runPreparedProfiles(twoProfiles);

  assert.deepEqual(calls, ["1-1", "1-2", "2-1", "2-2"]);
});

test("예약 오픈 전 두 예약자의 각 우선순위 세션을 동시에 제출하지 않고 순서대로 준비한다", async () => {
  const prepared = [];
  const engine = new ReservationEngine({ store: { updateStatus: async () => {} } });
  const twoProfiles = {
    ...config,
    useSecondProfile: true,
    profile1: { ...config.profile, reserverName: "예약자1" },
    profile2: { ...config.profile, reserverName: "예약자2" },
    roomPriority: [{ name: "샘_산맥존", enabled: true }, { name: "꿈_산맥존", enabled: true }]
  };
  engine.inspect = async () => [{ name: "샘_산맥존", available: true }, { name: "꿈_산맥존", available: true }];
  engine.createPrioritySession = (_config, room, profileEntry) => ({
    room, profileIndex: profileEntry.index, rank: room === "샘_산맥존" ? 1 : 2,
    config: { profile: profileEntry.profile },
    engine: {
      prepareSingle: async () => { prepared.push(`${profileEntry.profile.reserverName}-${room}`); },
      close: async () => {}
    }
  });

  await engine.preparePriorityCandidates(twoProfiles);

  assert.deepEqual(prepared, [
    "예약자1-샘_산맥존", "예약자1-꿈_산맥존",
    "예약자2-샘_산맥존", "예약자2-꿈_산맥존"
  ]);
});

test("예약 오픈 전 서버가 객실 데이터를 주지 않으면 실패시키지 않고 오픈 시 새로 진행한다", async () => {
  const statuses = [];
  const engine = new ReservationEngine({ store: { updateStatus: async (patch) => { statuses.push(patch); } } });
  const twoProfiles = {
    ...config,
    useSecondProfile: true,
    profile1: config.profile,
    profile2: { ...config.profile, reserverName: "예약자2" }
  };
  engine.inspect = async () => [];

  await engine.preparePriorityCandidates(twoProfiles);

  assert.equal(engine.prioritySessions.length, 0);
  assert.equal(statuses.at(-1).state, "waiting");
  assert.equal(statuses.at(-1).stage, "profiles-preparation-deferred");
});

test("단일 예약의 사전 준비 데이터가 없으면 오픈 시 준비됨으로 오인하지 않고 처음부터 진행한다", async () => {
  let receivedOptions;
  const engine = new ReservationEngine({ store: { updateStatus: async () => {} } });
  engine.runSingle = async (_config, options) => { receivedOptions = options; };

  await engine.run(config, { prepared: true });

  assert.equal(receivedOptions.prepared, false);
});
