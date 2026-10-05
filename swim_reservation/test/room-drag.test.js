import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { defaultConfig } from "../src/config.js";

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean).find(existsSync);
test("객실을 마우스·터치로 이동하고 취소·키보드 이동·저장 후 복원한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1200, height: 1000 }, hasTouch: mobile });
    let config = defaultConfig();
    config.roomPriority.forEach((room, index) => { room.enabled = index < 3; });
    const original = config.roomPriority.map(room => room.name);
    await page.route("https://app.test/**", async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/")) {
        if (pathname === "/api/config" && request.method() === "PUT") config = request.postDataJSON();
        const value = pathname === "/api/config" ? (request.method() === "PUT" ? { config } : config)
          : pathname === "/api/status" ? { state: "idle", stage: "idle" }
          : { entries: [], rooms: [], synced: true, serverNowMs: Date.now(), lastSyncedAt: Date.now(), offsetMs: 0, rttMs: 1 };
        return route.fulfill({ json: value });
      }
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../public/${file}`, import.meta.url)) });
    });
    await page.goto("https://app.test/");
    await page.locator("#roomList").scrollIntoViewIfNeeded();
    const labels = () => page.locator(".room-drag-handle").evaluateAll(xs => xs.map(x => x.getAttribute("aria-label").replace(" 순서 이동", "")));
    const handle = page.locator(".room-drag-handle").first();
    await handle.scrollIntoViewIfNeeded();
    const a = await handle.boundingBox();
    const b = await page.locator(".room-row").nth(2).boundingBox();
    const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const end = { x: start.x, y: b.y + b.height - 3 };
    if (mobile) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [end] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
    } else {
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 10 }); await page.mouse.up();
    }
    assert.deepEqual((await labels()).slice(0, 3), [original[1], original[2], original[0]]);
    assert.equal(await page.locator('.room-toggle input:checked').count(), 3);
    await page.locator(".room-drag-handle").nth(2).focus();
    await page.keyboard.press("ArrowUp");
    assert.deepEqual((await labels()).slice(0, 3), [original[1], original[0], original[2]]);
    const beforeCancel = await labels();
    const h = await page.locator(".room-drag-handle").first().boundingBox();
    await page.mouse.move(h.x + 20, h.y + 20); await page.mouse.down();
    await page.mouse.move(h.x + 20, h.y + 150);
    await page.keyboard.press("Escape"); await page.mouse.up();
    assert.deepEqual(await labels(), beforeCancel);
    await page.locator("#saveButton").click();
    await page.waitForFunction(() => document.body.innerText.includes("저장했습니다"));
    assert.deepEqual(config.roomPriority.map(x => x.name), beforeCancel);
    await page.reload();
    await page.locator(".room-drag-handle").first().waitFor();
    assert.deepEqual(await labels(), beforeCancel);
    await page.close();
  }
});
