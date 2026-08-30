import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { readPageDiagnostics } from "../src/page-diagnostics.js";

const executablePath = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean).find(existsSync);

test("진단 정보에는 폼 구조만 포함하고 입력값은 포함하지 않는다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <h1>예약자 정보</h1>
      <form id="reservation" action="/submit?token=PRIVATE_TOKEN" method="post">
        <table><tr><td>예약자명</td><td><input name="guest" value="VERY_PRIVATE_NAME"></td></tr></table>
        <input type="hidden" name="csrf" value="PRIVATE_CSRF">
        <button type="submit">예약하기</button>
      </form>
      <iframe name="policy" src="/policy?token=PRIVATE_FRAME_TOKEN"></iframe>`);

    const diagnostics = await page.evaluate(readPageDiagnostics);
    const serialized = JSON.stringify(diagnostics);

    assert.equal(diagnostics.forms[0].id, "reservation");
    assert.equal(diagnostics.fields.some((field) => field.name === "guest"), true);
    assert.equal(diagnostics.fields.some((field) => field.name === "csrf" && field.type === "hidden"), true);
    assert.equal(diagnostics.frames[0].name, "policy");
    assert.doesNotMatch(serialized, /VERY_PRIVATE_NAME|PRIVATE_CSRF|PRIVATE_TOKEN|PRIVATE_FRAME_TOKEN/);
  } finally {
    await browser.close();
  }
});
