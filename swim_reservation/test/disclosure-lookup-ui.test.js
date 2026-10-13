import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp } from "./fixtures/ui-book-app.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("예약 정보·취소 대기 설정은 각각 하나의 동일 글꼴 펼침이며 링크는 새 브라우저로 열린다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }), state = await mockBookApp(page);
    assert.equal(await page.locator("#startDate").inputValue(), "2026-12-20");
    assert.equal(await page.locator("#reservationConnectionDetails details").count(), 0);
    assert.equal(await page.locator("#triggerAt").isVisible(), false);
    await page.locator("#reservationConnectionDetails summary").click();
    assert.equal(await page.locator("#triggerAt").isVisible(), true);
    assert.equal(await page.locator("#epochValue").isVisible(), true);
    const href = await page.locator("#reservationUrl").getAttribute("href");
    assert.match(href, /^https:\/\/newpension\.logosweb\.or\.kr\/reservation\/reservation1\.php\?id=swim&adaystart=\d+$/);
    const visits = [];
    await page.context().route("https://newpension.logosweb.or.kr/**", route => { visits.push(route.request().method()); return route.fulfill({ contentType: "text/html", body: "<title>테스트 링크</title>실제 예약 사이트에 연결하지 않습니다." }); });
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.locator("#reservationUrl").click()]);
    await popup.waitForLoadState(); assert.equal(popup.url(), href); assert.deepEqual(visits, ["GET"]); await popup.close();
    const time = await page.locator("#triggerAt").inputValue();
    await page.locator("#reservationConnectionDetails summary").click(); assert.equal(await page.locator("#triggerAt").inputValue(), time);
    await page.locator("#startDate").fill(""); assert.equal(await page.locator("#reservationUrl").getAttribute("href"), null);
    await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="watch"]').click();
    assert.equal(await page.locator("#watchInterval").isVisible(), false);
    assert.equal(await page.locator("#watchEndsAt").isVisible(), false);
    await page.locator("#watchEndsAtDetails summary").click();
    assert.equal(await page.locator("#watchInterval").isVisible(), true);
    assert.equal(await page.locator("#watchEndsAt").isVisible(), true);
    const fonts = await page.evaluate(() => ["#reservationConnectionDetails summary", "#watchEndsAtDetails summary"].map(selector => { const style = getComputedStyle(document.querySelector(selector)); return `${style.fontSize}/${style.fontWeight}/${style.fontFamily}`; }));
    assert.equal(fonts[0], fonts[1]); assert.match(fonts[0], /^16px/);
    await page.locator("#watchInterval").fill("120"); await page.locator("#watchEndsAt").fill("2027-01-20T18:00");
    await page.locator("#watchEndsAtDetails summary").click(); assert.equal(await page.locator("#watchInterval").inputValue(), "120");
    await page.locator("#watchEndsAtDetails summary").click();
    await page.locator("#historyCard").screenshot({ path: `/tmp/swim-profiles.6W9Acs/unified-watch-settings-${width}.png` });
    assert.deepEqual(state.errors, []); assert.equal(state.planCalls.length, 0); await page.close();
  }
});
test("조회 원형 표시는 페이지 진입·중복 조회 동안 유지되고 성공/실패 시 해제되며 중복 타이틀을 제거한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), state = await mockBookApp(page);
  const releases = []; let fail = false;
  async function releaseNext() {
    for (let index = 0; !releases.length && index < 100; index++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(releases.length); releases.shift()();
  }
  await page.route("https://app.test/api/reservations", async route => {
    await new Promise(resolve => releases.push(resolve));
    await route.fulfill(fail ? { status: 503, json: { error: "조회 오류 테스트" } } : { json: { reservations: [], lookupErrors: [] } });
  });
  await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="people"]').click();
  await page.locator("#reservationLookupSpinner").waitFor();
  assert.equal(await page.locator("#reservationList").getAttribute("aria-busy"), "true");
  assert.equal(await page.locator("#reservationLookupSpinner").evaluate(el => getComputedStyle(el).animationName), "query-spin");
  await page.waitForFunction(() => savedLookupPending === 2); await releaseNext();
  await page.locator("#reservationLookupSpinner").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#reservationList").getAttribute("aria-busy"), "false");
  assert.equal(await page.locator("#lookupCard > h2").count(), 0);
  await page.evaluate(() => { window.parallelLookups = [loadReservations(), loadReservations()]; });
  await page.waitForFunction(() => savedLookupPending === 2);
  await releaseNext(); await page.waitForFunction(() => savedLookupPending === 1);
  assert.equal(await page.locator("#reservationLookupSpinner").isVisible(), true);
  await releaseNext(); await page.locator("#reservationLookupSpinner").waitFor({ state: "hidden" });
  fail = true; await page.locator("#reservationLookupButton").click();
  await page.waitForFunction(() => savedLookupPending === 1); await releaseNext();
  await page.waitForFunction(() => document.querySelector("#workspaceMessage").textContent.includes("조회 오류 테스트"));
  assert.equal(await page.locator("#reservationLookupSpinner").isVisible(), false);
  await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="book"]').click();
  assert.equal(await page.locator("#bookingBookCard > h2").count(), 0);
  await page.locator("#workspaceMenuButton").click(); await page.locator('[data-workspace-tab="logs"]').click();
  assert.equal(await page.locator("#workspaceMenuLabel").textContent(), "로그");
  assert.equal(await page.locator("#logCard h2").count(), 0);
  assert.deepEqual(state.errors, []); assert.equal(state.planCalls.length, 0);
});
