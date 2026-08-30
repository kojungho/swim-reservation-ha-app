import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { fillPersonalFields } from "../src/personal-fields.js";

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
