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

test("숨김 날짜값이 없어도 정상 객실표와 URL 날짜가 일치하면 통과한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://reservation.test/**", (route) => route.fulfill({
      contentType: "text/html",
      body: '<input type="checkbox" name="room_rid[0]"><select name="daytype[0]"><option value="1">1박</option></select>'
    }));
    const engine = new ReservationEngine({ store: {} });
    engine.page = page;

    await page.goto("https://reservation.test/reservation1.php?adaystart=1793977200");
    await assert.doesNotReject(() => engine.assertReservationDate({ startDate: "2026-11-07" }, { required: true }));

    await page.goto("https://reservation.test/reservation1.php?adaystart=1788015600");
    await assert.rejects(
      () => engine.assertReservationDate({ startDate: "2026-11-07" }, { required: true }),
      /사이트의 숙박 날짜가 선택한 날짜와 달라/
    );
  } finally {
    await browser.close();
  }
});

test("URL 날짜만 있고 정상 객실표가 없으면 계속 중지한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://reservation.test/**", (route) => route.fulfill({
      contentType: "text/html",
      body: "<p>요청을 처리할 수 없습니다.</p>"
    }));
    const engine = new ReservationEngine({ store: {} });
    engine.page = page;
    await page.goto("https://reservation.test/reservation1.php?adaystart=1793977200");

    await assert.rejects(
      () => engine.assertReservationDate({ startDate: "2026-11-07" }, { required: true }),
      /정상적인 객실 목록도 함께 찾지 못했습니다/
    );
  } finally {
    await browser.close();
  }
});
