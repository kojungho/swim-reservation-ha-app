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

test("숙박월 두 달 전 1일 00시를 제안한다", () => {
  assert.equal(bookingOpenIso("2026-11-07"), "2026-09-01T00:00:00");
  assert.equal(new Date(triggerEpoch("2026-09-01T00:00:00")).toISOString(), "2026-08-31T15:00:00.000Z");
});

test("객실 순위와 개인정보를 정규화하고 검증한다", () => {
  const config = normalizeConfig({
    startDate: "2026-11-07",
    triggerAt: "2026-09-01T00:00:00",
    nights: 2,
    roomPriority: [{ name: "달_하늘존", enabled: true }, { name: "해_하늘존", enabled: true }],
    profile: { reserverName: "예약자", depositorName: "입금자", phone: "010-1234-5678", birthDate: "19900101" }
  });
  assert.deepEqual(config.roomPriority.slice(0, 2), [
    { name: "달_하늘존", enabled: true },
    { name: "해_하늘존", enabled: true }
  ]);
  assert.equal(config.profile.phone, "01012345678");
  assert.deepEqual(validateConfig(config), []);
});
