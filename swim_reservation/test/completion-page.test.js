import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { ReservationEngine } from "../src/reservation-engine.js";
import { reservationErrorDetails } from "../src/reservation-errors.js";

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

test("HTTP 실패는 객실·응답 코드·경로를 보존하고 쿼리와 전화번호는 기록하지 않는다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const engine = new ReservationEngine({ store: { updateStatus: async () => {} }, browserProvider: async () => browser });
    await engine.ensurePage();
    await engine.page.route("**/*", route => route.fulfill({ status: 403, contentType: "text/html", body: "Forbidden" }));
    engine.assertReservationDate = async () => {};
    engine.collectDiagnostics = async () => ({});
    engine.startRoomAttempt = async () => {
      engine.selectedRoom = "솔_산맥존";
      await engine.page.goto("http://example.test/reservation/order_ok3.php?name=secret&tel=01011112222");
    };
    await assert.rejects(() => engine.runSingle({}), error => {
      assert.equal(error.room, "솔_산맥존");
      assert.equal(error.details.navigation.status, 403);
      assert.equal(error.details.page, "http://example.test/reservation/order_ok3.php");
      assert.ok(!JSON.stringify(error.details).includes("secret"));
      return true;
    });
    assert.ok(!reservationErrorDetails(new Error("http://example.test/a?tel=01011112222 phone 01011112222")).message.includes("01011112222"));
  } finally { await browser.close(); }
});

test("예약번호 안내는 성공이 아니며 완료 영수증은 예약자와 숙박 조건을 대조한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: "예약번호를 입력해 예약 내역을 조회하세요." }));
    await page.goto("http://example.test/reservation/order_ok7.php");
    const engine = new ReservationEngine({ store: {} });
    engine.page = page;
    engine.selectedRoom = "솔_산맥존";
    assert.equal(await engine.detectPage(), "unknown");
    const config = { startDate: "2026-12-22", nights: 1, profile: { reserverName: "한가람", phone: "01011112222" } };
    await assert.rejects(() => engine.verifyCompletion(config), /일치 확인하지 못/);
    await page.setContent(`<table><tr><td>이름</td><td>한가람</td></tr><tr><td>휴대폰</td><td>010-1111-2222</td></tr></table>
      <table><tr><td>솔_산맥존</td><td>2026년12월22일</td><td>1박</td><td>30평</td><td>2명</td><td>0명</td><td>60,000원</td><td>0원</td><td>60,000원</td><td><a onclick="del_ok1('123')">예약취소</a></td></tr></table>`);
    await engine.verifyCompletion(config);
    for (const patch of [{ startDate: "2026-12-23" }, { nights: 2 }, { profile: { reserverName: "다른이", phone: "01011112222" } }, { profile: { reserverName: "한가람", phone: "01033334444" } }]) {
      await assert.rejects(() => engine.verifyCompletion({ ...config, ...patch }), /일치 확인하지 못/);
    }
    engine.selectedRoom = "꿈_산맥존";
    await assert.rejects(() => engine.verifyCompletion(config), /일치 확인하지 못/);
  } finally { await browser.close(); }
});
