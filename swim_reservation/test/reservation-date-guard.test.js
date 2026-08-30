import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { ReservationEngine } from "../src/reservation-engine.js";

const executablePath = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean).find(existsSync);

test("사이트의 adaystart가 선택 날짜와 다르면 예약을 중지한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const engine = new ReservationEngine({ store: {} });
    engine.page = page;

    await page.setContent('<input type="hidden" name="adaystart" value="1788015600">');
    await assert.rejects(
      () => engine.assertReservationDate({ startDate: "2026-11-07" }, { required: true }),
      /사이트의 숙박 날짜가 선택한 날짜와 달라/
    );

    await page.setContent('<input type="hidden" name="adaystart" value="1793977200">');
    await assert.doesNotReject(() => engine.assertReservationDate({ startDate: "2026-11-07" }, { required: true }));
  } finally {
    await browser.close();
  }
});
