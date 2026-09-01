import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";

function sampleConfig(startDate, nights, firstRoom = "해_하늘존") {
  return {
    startDate,
    triggerAt: "2026-09-01T00:00:00",
    nights,
    roomPriority: [
      { name: firstRoom, enabled: true },
      { name: firstRoom === "해_하늘존" ? "달_하늘존" : "해_하늘존", enabled: false }
    ],
    profile: { reserverName: "예약자", depositorName: "입금자", phone: "01012345678", birthDate: "19900101" },
    autoFinalSubmit: true
  };
}

test("날짜와 박수 조합별 이력을 저장하고 같은 조합은 갱신한다", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "swim-store-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new Store(dataDir);
  await store.init();

  await store.saveConfig(sampleConfig("2026-10-22", 2));
  await store.saveConfig(sampleConfig("2026-11-07", 1));
  await store.saveConfig(sampleConfig("2026-10-22", 2, "달_하늘존"));

  const history = await store.listHistory();
  assert.equal(history.length, 2);
  const october = history.find((entry) => entry.startDate === "2026-10-22");
  assert.deepEqual(october.enabledRooms, ["달_하늘존"]);
});

test("이력을 현재 설정으로 불러오고 해당 이력만 삭제한다", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "swim-store-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new Store(dataDir);
  await store.init();

  await store.saveConfig(sampleConfig("2026-10-22", 2));
  await store.saveConfig(sampleConfig("2026-11-07", 1));
  const loaded = await store.loadHistory("2026-10-22__2");
  assert.equal(loaded.config.startDate, "2026-10-22");
  assert.equal((await store.getConfig()).nights, 2);

  assert.equal(await store.deleteHistory("2026-10-22__2"), true);
  assert.equal(await store.deleteHistory("2026-10-22__2"), false);
  assert.deepEqual((await store.listHistory()).map((entry) => entry.id), ["2026-11-07__1"]);
});

test("예약자 1·2 정보와 사용 여부를 저장 후 독립적으로 복원한다", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "swim-store-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new Store(dataDir);
  await store.init();
  await store.saveConfig({
    ...sampleConfig("2026-11-07", 1),
    useSecondProfile: true,
    profile1: { reserverName: "예약자1", depositorName: "입금자1", phone: "01011112222", birthDate: "19900101" },
    profile2: { reserverName: "예약자2", depositorName: "입금자2", phone: "01033334444", birthDate: "19920202" }
  });
  const restored = await store.getConfig();
  assert.equal(restored.useSecondProfile, true);
  assert.equal(restored.profile1.reserverName, "예약자1");
  assert.equal(restored.profile2.reserverName, "예약자2");
  assert.notDeepEqual(restored.profile1, restored.profile2);
});

test("새로 감지한 객실을 미선택 상태로 영구 추가하고 로그를 남긴다", async (context) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "swim-store-"));
  context.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = new Store(dataDir);
  await store.init();
  await store.saveConfig(sampleConfig("2026-11-07", 1), { recordHistory: false });

  const result = await store.mergeDiscoveredRooms(["신규_계곡존", "신규_계곡존"]);
  const restored = await store.getConfig();
  const logs = await store.listLogs();

  assert.deepEqual(result.addedRooms, ["신규_계곡존"]);
  assert.deepEqual(restored.roomPriority.find((room) => room.name === "신규_계곡존"), { name: "신규_계곡존", enabled: false });
  assert.equal(logs.some((entry) => entry.event === "room-detected"), true);
});
