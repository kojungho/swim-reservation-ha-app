import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { fillPersonalFields } from "../src/personal-fields.js";
import { ReservationEngine } from "../src/reservation-engine.js";

const chromiumPaths = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
const executablePath = chromiumPaths.find(existsSync);

test("PHP 테이블 HTML의 왼쪽 제목 칸을 분석해 개인정보를 입력한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <form>
        <table>
          <tr><td>예약자명</td><td><input name="guest_value"></td></tr>
          <tr><td>입금자명</td><td><input name="bankname"></td></tr>
          <tr><td>휴대폰 번호</td><td><select name="p1"><option value="010">010</option></select><input name="p2"><input name="p3"></td></tr>
          <tr><td>생년월일 6자리</td><td><input name="personal_date" maxlength="6"></td></tr>
        </table>
      </form>`);

    const engine = new ReservationEngine({ store: {} });
    engine.page = page;
    assert.equal(await engine.detectPage(), "personal");

    const result = await page.evaluate(fillPersonalFields, {
      reserverName: "예약자",
      depositorName: "입금자",
      phone: "01012345678",
      birthDate: "19900101"
    });

    assert.deepEqual(result.filled, { reserverName: true, depositorName: true, phone: true, birthDate: true });
    assert.deepEqual(await page.locator("input, select").evaluateAll((controls) => controls.map((control) => control.value)), [
      "예약자", "입금자", "010", "1234", "5678", "900101"
    ]);
  } finally {
    await browser.close();
  }
});

test("실제 order_ok2.php의 분할 전화번호와 생년월일 select를 입력한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <form name="form" action="order_ok3.php">
        <table>
          <tr><td>예약자명</td><td><input name="name"></td></tr>
          <tr><td>입금자명</td><td><input name="name2"></td></tr>
          <tr><td>휴대폰</td><td><input name="tel1"><input name="tel2"><input name="tel3"></td></tr>
          <tr><td>생년월일</td><td>
            <select name="birthYear"><option value="">선택</option><option value="1990">1990</option></select>
            <select name="birthMonth"><option value="">선택</option><option value="8">8</option></select>
            <select name="birthDay"><option value="">선택</option><option value="30">30</option></select>
          </td></tr>
        </table>
      </form>`);

    const engine = new ReservationEngine({ store: {} });
    engine.page = page;
    assert.equal(await engine.detectPage(), "personal");

    const result = await page.evaluate(fillPersonalFields, {
      reserverName: "예약자",
      depositorName: "입금자",
      phone: "01012345678",
      birthDate: "19900830"
    });

    assert.deepEqual(result.filled, { reserverName: true, depositorName: true, phone: true, birthDate: true });
    assert.deepEqual(await page.locator("input, select").evaluateAll((controls) => controls.map((control) => control.value)), [
      "예약자", "입금자", "010", "1234", "5678", "1990", "8", "30"
    ]);
  } finally {
    await browser.close();
  }
});

test("환불 규정의 개인정보 안내 문구를 예약자 입력 페이지로 오인하지 않는다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const engine = new ReservationEngine({ store: {} });
    engine.page = page;
    await page.setContent(`
      <p>예약자는 휴대폰 번호를 정확히 입력해야 하며 환불 및 취소 규정에 동의해야 합니다.</p>
      <label><input type="checkbox" name="agree"> 동의합니다</label>
      <textarea name="notice"></textarea>`);

    assert.equal(await engine.detectPage(), "terms");
  } finally {
    await browser.close();
  }
});
