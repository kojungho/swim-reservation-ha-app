import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp } from "./fixtures/ui-book-app.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("플로팅 메뉴는 선택 이름·활성 색상·드롭다운 닫기·스크롤 위치·키보드를 지원한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const state = await mockBookApp(page);
    const button = page.locator("#workspaceMenuButton"), menu = page.locator("#workspaceMenu");
    assert.equal(await menu.isVisible(), false);
    await button.click();
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    assert.equal(await menu.getByRole("button").count(), 8);
    await page.locator('[data-workspace-tab="book"]').click();
    assert.equal(await menu.isVisible(), false);
    assert.equal(await page.locator("#workspaceMenuLabel").textContent(), "예약자 정보");
    await button.click();
    const colors = await page.evaluate(() => [getComputedStyle(document.querySelector('[data-workspace-tab="book"]')).backgroundColor, getComputedStyle(document.querySelector('[data-workspace-tab="priority"]')).backgroundColor]);
    assert.notEqual(colors[0], colors[1]);
    assert.equal(await page.locator('[data-workspace-tab="book"]').getAttribute("aria-current"), "page");
    await page.keyboard.press("Escape");
    assert.equal(await menu.isVisible(), false);
    assert.equal(await button.evaluate(el => el === document.activeElement), true);
    const before = await button.boundingBox();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const after = await button.boundingBox(); assert.ok(Math.abs(before.y - after.y) < 1);
    await button.click(); await page.mouse.click(width - 8, 600); assert.equal(await menu.isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(state.errors, []); await page.close();
  }
});
