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

test("order_ok4.php의 예약자 정보 화면을 예약 완료로 판정한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/reservation/order_ok4.php", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <h2>예약자 정보</h2>
        <p>휴대폰</p>
        <h2>입금계좌번호안내</h2>
        <a href="javascript:void(0)" onclick="del_ok1('123')">예약취소</a>`
    }));
    await page.goto("http://example.test/reservation/order_ok4.php");
    const engine = new ReservationEngine({ store: {} });
    engine.page = page;

    assert.equal(await engine.detectPage(), "success");
  } finally {
    await browser.close();
  }
});
