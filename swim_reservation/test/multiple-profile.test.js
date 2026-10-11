import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, validateConfig } from "../src/config.js";
import { ReservationEngine } from "../src/reservation-engine.js";

test("5명이 저장되어도 여러 객실 모드를 유지하고 선택한 한 명만 각 객실에 적용한다", () => {
  const config = normalizeConfig({ bookingMode: "multiple", multipleProfileIndex: 3, startDate: "2026-12-04", triggerAt: "2026-10-01T00:00:00", nights: 1,
    roomPriority: [{ name: "해_하늘존", enabled: true }, { name: "달_하늘존", enabled: true }],
    profiles: Array.from({ length: 5 }, (_, index) => ({ reserverName: `예약자${index + 1}`, depositorName: `입금자${index + 1}`, phone: `0101234567${index}`, birthDate: "19900101" })) });
  assert.deepEqual(validateConfig(config), []);
  assert.equal(normalizeConfig(config).multipleProfileIndex, 3);
  const engine = new ReservationEngine({ store: {} });
  for (const room of ["해_하늘존", "달_하늘존"]) {
    const session = engine.createChildSession(config, room);
    assert.equal(session.config.profiles.length, 1);
    assert.equal(session.config.profile.reserverName, "예약자4");
    assert.equal(session.config.profile.phone, "01012345673");
    assert.deepEqual(session.config.profile, session.config.profiles[0]);
    assert.deepEqual(session.config.roomPriority.filter(item => item.enabled).map(item => item.name), [room]);
  }
  for (const value of [-1, 5, 1.5, NaN]) {
    config.multipleProfileIndex = value;
    assert.match(validateConfig(config).join(","), /여러 객실 동시 예약에 사용할 예약자/);
  }
});
