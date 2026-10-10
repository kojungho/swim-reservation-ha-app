import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeConfig, validateConfig, getProfiles } from "../src/config.js";
import { Store } from "../src/store.js";
import { ReservationEngine } from "../src/reservation-engine.js";

function sample() {
  return normalizeConfig({ startDate: "2026-12-04", triggerAt: "2026-10-01T00:00:00", nights: 1,
    roomPriority: [{ name: "해_하늘존", enabled: true }],
    profiles: Array.from({ length: 5 }, (_, i) => ({ reserverName: `예약자${i+1}`, depositorName: `입금자${i+1}`, phone: `0101234567${i}`, birthDate: "19900101" })) });
}

test("5명 설정·이력 복원 및 6명 입력 거부", async t => {
  const config = sample();
  assert.deepEqual(validateConfig(config), []);
  const dir = await mkdtemp(path.join(tmpdir(), "swim-profiles-"));
  const store = new Store(dir);
  t.after(async () => { await store.logQueue; await rm(dir, { recursive: true, force: true }); });
  await store.init(); await store.saveConfig(config);
  assert.deepEqual(getProfiles(await store.getConfig()), config.profiles);
  assert.equal((await store.listHistory())[0].profileCount, 5);
  assert.deepEqual((await store.loadHistory("2026-12-04__1")).config.profiles, config.profiles);
  config.profiles.push(config.profiles[0]);
  assert.match(validateConfig(normalizeConfig(config)).join(","), /1~5명/);
  config.profiles = [];
  assert.match(validateConfig(normalizeConfig(config)).join(","), /1~5명/);
});

test("다섯 예약자는 독립 정보로 순차 실행하고 중간 실패 시 이후 실행을 멈춘다", async () => {
  for (const failAt of [-1, 2]) {
    const config = sample(), calls = [], statuses = [];
    const engine = new ReservationEngine({ store: { updateStatus: async p => statuses.push(structuredClone(p)) } });
    const original = engine.createPrioritySession.bind(engine);
    engine.createPrioritySession = (cfg, room, entry) => {
      const session = original(cfg, room, entry);
      assert.equal(session.config.profiles.length, 1);
      assert.deepEqual(session.config.profile, config.profiles[entry.index]);
      session.engine.runSingle = async child => {
        calls.push(child.profile.reserverName);
        if (entry.index === failAt) throw new Error("테스트 실패");
        return { room: "해_하늘존" };
      };
      return session;
    };
    if (failAt < 0) {
      await engine.run(config);
      assert.equal(statuses.at(-1).profileStatuses.length, 5);
      assert.match(statuses.at(-1).message, /5명/);
      assert.equal(calls.length, 5);
    } else {
      await assert.rejects(engine.run(config), /테스트 실패/);
      assert.deepEqual(calls, ["예약자1", "예약자2", "예약자3"]);
    }
  }
});
