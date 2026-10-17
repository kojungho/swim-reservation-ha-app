import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp } from "./fixtures/ui-book-app.js";
import { DEFAULT_UI_SETTINGS } from "../src/ui-settings.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);

test("플로팅 버튼은 모바일 명칭·아이콘 토글·크기 저장·스크롤 복귀·겹침 방지를 지원한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    const state = await mockBookApp(page); let saved = structuredClone(DEFAULT_UI_SETTINGS);
    await page.route("**/api/ui-settings", route => { if (route.request().method() === "PUT") saved = route.request().postDataJSON(); return route.fulfill({ json: saved }); });
    assert.equal(await page.locator("#scrollTopButton").isVisible(), false);
    assert.equal(await page.locator(".site-map-label").innerText(), "배치도");
    assert.equal(await page.locator(".site-map-icon").isVisible(), width > 600);
    await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="settings"]').click();
    await page.locator("#setting-mapIcon").uncheck();
    assert.equal(await page.locator(".site-map-icon").isVisible(), false);
    await page.locator("#setting-floatingSize").fill("64");
    assert.equal((await page.locator("#siteMapButton").boundingBox()).height, 64);
    assert.equal((await page.locator("#workspaceMenuButton").boundingBox()).height, 64);
    await page.locator("#settingsSave").click(); await page.waitForFunction(() => document.getElementById("settingsMessage").textContent.includes("저장했습니다"));
    assert.equal(saved.floatingSize, 64); assert.equal(saved.mapIcon, false);
    await page.reload(); await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--floating-size") === "64px");
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.locator("#scrollTopButton").waitFor({ state: "visible" });
    let box = await page.locator("#scrollTopButton").boundingBox();
    assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < 1);
    assert.equal(box.height, 64);
    await page.locator("#scrollTopButton").click(); await page.waitForFunction(() => scrollY === 0);
    await page.locator("#scrollTopButton").waitFor({ state: "hidden" });
    await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="settings"]').click();
    await page.locator("#setting-menuCorner").selectOption("bottom-right");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.locator("#scrollTopButton").waitFor({ state: "visible" });
    box = await page.locator("#scrollTopButton").boundingBox();
    for (const selector of ["#siteMapButton", "#workspaceMenuButton"]) {
      const other = await page.locator(selector).boundingBox();
      assert.ok(box.y + box.height <= other.y - 6 || box.x + box.width <= other.x - 6 || other.x + other.width <= box.x - 6);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `/tmp/swim-repair.tspABK/floating-${width}.png` });
    assert.deepEqual(state.errors, []); assert.equal(state.planCalls.length, 0);
    await page.close();
  }
});
