import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { defaultConfig } from "../src/config.js";

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean).find(existsSync);
test("PC·휴대폰 도움말은 선택한 모드를 펼치고 예약 설정을 바꾸지 않으며 닫기·Escape·배경 클릭을 지원한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const mutations = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://app.test/**", async route => {
      const req = route.request(), pathname = new URL(req.url()).pathname;
      if (pathname.startsWith("/api/")) {
        if (req.method() !== "GET" && pathname !== "/api/inspect") mutations.push(pathname);
        const data = pathname === "/api/config" ? defaultConfig()
          : pathname === "/api/status" ? { state: "idle", stage: "idle" }
          : { entries: [], rooms: [], synced: true, serverNowMs: Date.now(), lastSyncedAt: Date.now(), offsetMs: 0, rttMs: 1 };
        return route.fulfill({ json: data });
      }
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../public/${file}`, import.meta.url)) });
    });
    await page.goto("https://app.test/");
    const layout = await page.evaluate(() => {
      const nights = document.querySelector("#nights").getBoundingClientRect();
      const mode = document.querySelector("#bookingMode").getBoundingClientRect();
      const icon = document.querySelector("#bookingHelpButton").getBoundingClientRect();
      return { nightsTop: nights.top, modeTop: mode.top, iconWidth: icon.width, iconHeight: icon.height };
    });
    if (width === 1280) assert.ok(Math.abs(layout.nightsTop - layout.modeTop) < 1, "박수와 예약 방식의 선택란 상단 정렬");
    assert.equal(layout.iconWidth, 20);
    assert.equal(layout.iconHeight, 20);
    for (const mode of ["priority", "multiple", "profiles-parallel"]) {
      await page.locator("#bookingMode").selectOption(mode);
      await page.getByRole("button", { name: "예약 모드별 사용 방법", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "예약 모드별 사용 방법", exact: true });
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await dialog.locator("details[open]").count(), 1);
      assert.equal(await dialog.locator(`[data-booking-help="${mode}"]`).evaluate(el => el.open), true);
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      const other = mode === "multiple" ? "priority" : "multiple";
      await dialog.locator(`[data-booking-help="${other}"] summary`).click();
      assert.equal(await page.locator("#bookingMode").inputValue(), mode);
      await page.getByRole("button", { name: "사용 방법 닫기", exact: true }).click();
      assert.equal(await dialog.isVisible(), false);
      assert.equal(await page.locator("#bookingHelpButton").evaluate(el => el === document.activeElement), true);
    }
    await page.locator("#bookingHelpButton").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#bookingHelpDialog").isVisible(), false);
    await page.locator("#bookingHelpButton").click();
    // Interior padding must not be mistaken for the backdrop.
    await page.locator("#bookingHelpDialog").evaluate(el => el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: el.getBoundingClientRect().left + 2, clientY: el.getBoundingClientRect().top + 2 })));
    assert.equal(await page.locator("#bookingHelpDialog").isVisible(), true);
    await page.mouse.click(2, 2);
    assert.equal(await page.locator("#bookingHelpDialog").isVisible(), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(mutations, []);
    await page.close();
  }
});
