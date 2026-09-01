import test from "node:test";
import assert from "node:assert/strict";
import {
  bookingOpenIso,
  normalizeConfig,
  reservationUrl,
  startEpoch,
  triggerEpoch,
  validateConfig
} from "../src/config.js";

test("2026-11-07 링크 타임스탬프를 정확히 생성한다", () => {
  assert.equal(startEpoch("2026-11-07") / 1000, 1793977200);
  assert.equal(
    reservationUrl("2026-11-07"),
    "http://newpension.logosweb.or.kr/reservation/reservation1.php?id=swim&adaystart=1793977200"
  );
});

test("날짜가 하루 늘면 타임스탬프가 86400 증가한다", () => {
  assert.equal((startEpoch("2026-11-08") - startEpoch("2026-11-07")) / 1000, 86400);
  assert.equal(startEpoch("2026-11-08") / 1000, 1794063600);
});

test("2026-10-22 링크 타임스탬프를 정확히 생성한다", () => {
  assert.equal(startEpoch("2026-10-22") / 1000, 1792594800);
  assert.match(reservationUrl("2026-10-22"), /adaystart=1792594800$/);
});

test("숙박월 두 달 전 1일 00시를 제안한다", () => {
  assert.equal(bookingOpenIso("2026-11-07"), "2026-09-01T00:00:00");
  assert.equal(new Date(triggerEpoch("2026-09-01T00:00:00")).toISOString(), "2026-08-31T15:00:00.000Z");
});

test("객실 순위와 개인정보를 정규화하고 검증한다", () => {
  const config = normalizeConfig({
    startDate: "2026-11-07",
    triggerAt: "2026-09-01T00:00:00",
    nights: 2,
    bookingMode: "multiple",
    roomPriority: [{ name: "달_하늘존", enabled: true }, { name: "해_하늘존", enabled: true }],
    profile: { reserverName: "예약자", depositorName: "입금자", phone: "010-1234-5678", birthDate: "19900101" }
  });
  assert.deepEqual(config.roomPriority.slice(0, 2), [
    { name: "달_하늘존", enabled: true },
    { name: "해_하늘존", enabled: true }
  ]);
  assert.equal(config.profile.phone, "01012345678");
  assert.equal(config.bookingMode, "multiple");
  assert.deepEqual(validateConfig(config), []);
});

test("동시 예약은 미니 PC 보호를 위해 최대 5개 객실로 제한한다", () => {
  const config = normalizeConfig({
    startDate: "2026-11-07",
    triggerAt: "2026-09-01T00:00:00",
    nights: 1,
    bookingMode: "multiple",
    roomPriority: ["해_하늘존", "달_하늘존", "별_하늘존", "빛_하늘존", "강_하늘존", "산_하늘존"].map((name) => ({ name, enabled: true })),
    profile: { reserverName: "예약자", depositorName: "입금자", phone: "01012345678", birthDate: "19900101" }
  });
  assert.match(validateConfig(config).join(","), /최대 5개/);
});

test("기존 단일 예약자 설정은 예약자 1로 복원되고 예약자 2 사용은 기본 OFF다", () => {
  const config = normalizeConfig({
    startDate: "2026-11-07", triggerAt: "2026-09-01T00:00:00", nights: 1,
    roomPriority: [{ name: "해_하늘존", enabled: true }],
    profile: { reserverName: "기존예약자", depositorName: "기존입금자", phone: "01012345678", birthDate: "19900101" }
  });
  assert.equal(config.profile1.reserverName, "기존예약자");
  assert.deepEqual(config.profile, config.profile1);
  assert.equal(config.useSecondProfile, false);
});

test("예약자 2명 사용 시 두 정보를 독립 저장하고 예약자 2도 검증한다", () => {
  const config = normalizeConfig({
    startDate: "2026-11-07", triggerAt: "2026-09-01T00:00:00", nights: 1,
    roomPriority: [{ name: "해_하늘존", enabled: true }], useSecondProfile: true,
    profile1: { reserverName: "예약자1", depositorName: "입금자1", phone: "01011112222", birthDate: "19900101" },
    profile2: { reserverName: "예약자2", depositorName: "입금자2", phone: "01033334444", birthDate: "19920202" }
  });
  assert.equal(config.profile1.phone, "01011112222");
  assert.equal(config.profile2.phone, "01033334444");
  assert.deepEqual(validateConfig(config), []);
  config.profile2.phone = "";
  assert.match(validateConfig(config).join(","), /예약자 2 휴대폰 번호/);
});

test("예약 대기 시각 검증에 사이트 서버 기준 시각을 주입할 수 있다", () => {
  const config = normalizeConfig({
    startDate: "2026-11-07", triggerAt: "2026-09-01T00:00:00", nights: 1,
    roomPriority: [{ name: "해_하늘존", enabled: true }],
    profile: { reserverName: "예약자", depositorName: "입금자", phone: "01012345678", birthDate: "19900101" }
  });
  const trigger = triggerEpoch(config.triggerAt);
  assert.deepEqual(validateConfig(config, { futureTrigger: true, nowMs: trigger - 1 }), []);
  assert.match(validateConfig(config, { futureTrigger: true, nowMs: trigger }).join(","), /현재 이후/);
});

test("사이트에서 새로 감지한 객실을 고정 목록에 없어도 유지한다", () => {
  const config = normalizeConfig({
    startDate: "2026-11-07", triggerAt: "2026-09-01T00:00:00", nights: 1,
    roomPriority: [{ name: "신규_계곡존", enabled: true }],
    profile: { reserverName: "예약자", depositorName: "입금자", phone: "01012345678", birthDate: "19900101" }
  });
  assert.deepEqual(config.roomPriority[0], { name: "신규_계곡존", enabled: true });
  assert.equal(config.roomPriority.some((room) => room.name === "해_하늘존"), true);
});
