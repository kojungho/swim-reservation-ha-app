import test from "node:test";
import assert from "node:assert/strict";
import { chromiumUserAgent } from "../src/reservation-engine.js";

test("예약 사이트 요청에서 HeadlessChrome 표식을 제거한다", () => {
  const userAgent = chromiumUserAgent({ version: () => "140.0.7339.0" });

  assert.match(userAgent, /Chrome\/140\.0\.7339\.0/);
  assert.doesNotMatch(userAgent, /HeadlessChrome/);
});
