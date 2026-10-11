import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeConfig, validateConfig, normalizeProfile } from "../src/config.js";
import { Store } from "../src/store.js";
import { ReservationEngine } from "../src/reservation-engine.js";
import { ReservationManager } from "../src/reservation-manager.js";
import { lookupProfiles } from "../src/profile-lookup.js";

const profiles = Array.from({ length: 5 }, (_, index) => ({ reserverName: `예약자${index + 1}`, depositorName: `입금자${index + 1}`, phone: `0101234567${index}`, birthDate: "19900101", roomPriority: [{ name: `객실${index}-1`, enabled: true }, { name: `객실${index}-2`, enabled: true }] }));
const sample = () => normalizeConfig({ startDate: "2026-12-04", nights: 1, triggerAt: "2026-10-01T00:00:00", bookingMode: "profiles-parallel", profiles });

test("예약자별 동시 모드는 공통 객실 대신 각자의 우선순위를 검증한다", () => {
  const config = sample();
  assert.deepEqual(validateConfig(config), []);
  config.profiles[2].roomPriority = [];
  assert.match(validateConfig(config).join(","), /예약자 3의 예약할 객실/);
});

test("예약자 5명 별도 저장은 날짜·박수와 독립되고 이력 불러오기에도 유지된다", async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "swim-book-"));
  const store = new Store(dir);
  t.after(() => rm(dir, { recursive: true, force: true }));
  await store.init();
  await store.saveConfig(sample());
  await store.saveProfiles(profiles);
  await store.saveConfig({ ...sample(), profiles: [profiles[0]] });
  await store.loadHistory("2026-12-04__1");
  assert.deepEqual(await new Store(dir).getSavedProfiles(), profiles.map(normalizeProfile));
});

test("예약확인은 5명 모두 조회하며 한 명 오류에도 나머지 결과와 정상 0건을 보존한다", async () => {
  const called = [];
  const result = await lookupProfiles(profiles, { list: async profile => {
    called.push(profile.reserverName);
    if (profile === profiles[1]) throw new Error("사이트 연결 실패");
    if (profile === profiles[2]) return [];
    return [{ id: "123", room: "테스트" }];
  } });
  assert.equal(called.length, 5);
  assert.equal(result.reservations.length, 3);
  assert.equal(result.lookupErrors[0].profileIndex, 1);
  assert.equal(result.lookupStatuses[2].count, 0);
  assert.equal(result.lookupStatuses[1].count, undefined);
  assert.equal(result.reservations.at(-1).profileIndex, 4);
});

test("조회 페이지 HTTP 오류와 정상 페이지 아님을 0건으로 판정하지 않는다", async () => {
  const manager = new ReservationManager();
  await assert.rejects(manager.load({ goto: async () => ({ ok: () => false, status: () => 403 }) }, profiles[0]), /응답 403/);
  await assert.rejects(manager.load({ goto: async () => ({ ok: () => true }), evaluate: async () => false }, profiles[0]), /정상적인 예약확인/);
});

test("5명의 각자 우선순위 준비는 최종 제출 없이 독립된 개인정보와 객실을 사용한다", async () => {
  const config = sample(), prepared = [];
  const engine = new ReservationEngine({ store: { updateStatus: async () => {} } });
  engine.inspect = async () => profiles.flatMap(profile => profile.roomPriority.map(room => ({ name: room.name, available: true })));
  const original = engine.createPrioritySession.bind(engine);
  engine.createPrioritySession = (cfg, room, entry) => {
    const session = original(cfg, room, entry);
    session.engine.prepareSingle = async child => {
      prepared.push({ name: child.profile.reserverName, room, rank: session.rank });
      assert.equal(child.bookingMode, "priority");
      assert.deepEqual(child.roomPriority.filter(item => item.enabled).map(item => item.name), [room]);
    };
    return session;
  };
  await engine.prepare(config);
  assert.equal(prepared.length, 10);
  assert.deepEqual(prepared.slice(0, 2), [{ name: "예약자1", room: "객실0-1", rank: 1 }, { name: "예약자1", room: "객실0-2", rank: 2 }]);
  await engine.close();
});

test("준비된 5명은 함께 제출하고 확실한 마감만 다음 순위 시도, 불확실하면 해당 사람만 중단한다", async () => {
  const config = sample(), calls = [], statuses = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const engine = new ReservationEngine({ store: { updateStatus: async patch => statuses.push(structuredClone(patch)) } });
  engine.prioritySessions = profiles.flatMap((profile, profileIndex) => profile.roomPriority.map((room, index) => ({
    profileIndex, rank: index + 1, room: room.name, config: { profile }, status: {},
    engine: { close: async () => {}, runSingle: async (_config, options) => {
      assert.equal(options.prepared, true);
      assert.equal(options.allowFallback, false);
      calls.push(`${profileIndex}-${index}`);
      if (index === 0) await gate;
      if (profileIndex === 1) throw new Error("제출 결과 알 수 없음");
      if (profileIndex === 0 && index === 0) throw Object.assign(new Error("마감"), { code: "ROOM_UNAVAILABLE" });
      return { room: room.name };
    } }
  })));
  const running = engine.run(config, { prepared: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["0-0", "1-0", "2-0", "3-0", "4-0"]);
  release();
  const completed = await running;
  assert.equal(completed.length, 4);
  assert.equal(calls.includes("0-1"), true);
  assert.equal(calls.includes("1-1"), false);
  assert.equal(statuses.at(-1).profileStatuses[1].state, "결과 확인 필요");
  assert.equal(statuses.at(-1).stage, "profiles-parallel-partial");
});

test("즉시 동시 예약은 준비된 것으로 오인하지 않고 사람별 설정으로 처음부터 실행한다", async () => {
  const config = sample(), calls = [];
  const engine = new ReservationEngine({ store: { updateStatus: async () => {} } });
  const original = engine.createPrioritySession.bind(engine);
  engine.createPrioritySession = (cfg, room, entry) => {
    const session = original(cfg, room, entry);
    session.engine.runSingle = async (child, options) => {
      calls.push(entry.index);
      assert.equal(options.prepared, false);
      assert.deepEqual(child.roomPriority, entry.profile.roomPriority);
      return { room: child.roomPriority[0].name };
    };
    return session;
  };
  await engine.run(config);
  assert.equal(calls.length, 5);
});
