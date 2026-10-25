import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { mockBookApp } from "./fixtures/ui-book-app.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);

test("설정에서 제출 간격 기본 5초·1초·0 미사용을 PC와 폰에서 저장한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); const state = await mockBookApp(page);
    await page.evaluate(() => switchWorkspaceTab("settings"));
    const input = page.locator("#finalSubmitInterval"); assert.equal(await input.inputValue(), "5");
    for (const seconds of [1, 0, 7]) {
      await input.fill(String(seconds)); await page.locator("#saveFinalSubmitInterval").click();
      await page.waitForFunction(value => document.getElementById("submissionSettingsMessage").textContent.includes(value === 0 ? "미사용(0초)" : `${value}초로 저장`), seconds);
      assert.equal(state.submissionSettings.intervalSeconds, seconds);
    }
    await input.fill("-1"); await page.locator("#saveFinalSubmitInterval").click();
    assert.equal(state.submissionSettings.intervalSeconds, 7);
    await page.reload(); await page.waitForFunction(() => document.getElementById("finalSubmitInterval").value === "7");
    assert.deepEqual(state.errors, []); await page.close();
  }
});

test("서버 업데이트는 화면에 안내하고 구버전 화면에서 실제 취소를 보내지 않는다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await mockBookApp(page);
  let canceled = 0;
  await page.route("**/api/reservations/*/cancel", route => { canceled++; return route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/status", route => {
    assert.equal(route.request().headers()["x-swim-client-version"], "2.15.7");
    return route.fulfill({ json: { state: "idle", appVersion: "2.14.5" } });
  });
  await page.evaluate(async () => {
    nextStatusCheck = 0; await refreshStatus();
    renderReservations([{ id: "123", room: "솔_산맥존", stayDate: "2026-12-22", nights: "1박", cancelable: true }]);
    document.querySelector(".reservation-cancel-button").click();
  });
  assert.equal(await page.locator("#screenUpdateNotice").isVisible(), true);
  assert.match(await page.locator("#screenUpdateNotice").textContent(), /화면 2.15.7.*서버 2.14.5/);
  assert.equal(canceled, 0);
  await page.route("**/api/status", route => route.fulfill({ json: { state: "idle", appVersion: "2.15.7" } }));
  await page.evaluate(async () => { nextStatusCheck = 0; await refreshStatus(); });
  assert.equal(await page.locator("#screenUpdateNotice").isVisible(), false);
});

test("상태 연결 실패는 기존 결과를 덮지 않고 복구되며 변경 요청은 재전송하지 않는다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(), state = await mockBookApp(page);
  const original = await page.locator("#statusText").textContent();
  await page.route("**/api/status", route => route.abort("failed"));
  await page.evaluate(async () => { nextStatusCheck = 0; await refreshStatus(); });
  assert.equal(await page.locator("#connectionNotice").isVisible(), true);
  assert.equal(await page.locator("#statusText").textContent(), original);
  assert.ok(!(await page.locator("#connectionNotice").textContent()).includes("Failed to fetch"));
  await page.unroute("**/api/status");
  await page.locator("#reconnectButton").click();
  await page.waitForFunction(() => document.getElementById("connectionNotice").hidden);
  let submitted = 0;
  await page.route("**/api/mutation-test", route => { submitted++; return route.abort("failed"); });
  const error = await page.evaluate(async () => { try { await request("mutation-test", { method: "POST", body: "{}" }); } catch (error) { return { message: error.message, code: error.code }; } });
  assert.equal(submitted, 1); assert.equal(error.code, "CONNECTION_LOST"); assert.match(error.message, /자동 재전송하지 않습니다/);
  assert.deepEqual(state.errors, []);
});

test("상태 요청은 겹치지 않고 로그인 HTML을 정상 상태로 오인하지 않는다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await mockBookApp(page);
  let calls = 0;
  await page.route("**/api/status", async route => { calls++; await new Promise(resolve => setTimeout(resolve, 150)); await route.fulfill({ contentType: "text/html", body: "Login" }); });
  await page.evaluate(async () => { nextStatusCheck = 0; await Promise.all([refreshStatus(), refreshStatus(), refreshStatus()]); });
  assert.equal(calls, 1);
  assert.equal(await page.locator("#connectionNotice").isVisible(), true);
  assert.equal(await page.evaluate(() => statusFailures), 1);
  const failed = await page.evaluate(async () => { try { await request("status"); } catch (error) { return error.code; } });
  assert.equal(failed, "CONNECTION_LOST");
});

test("설정에서 업데이트 버튼은 제거하고 실행·화면 버전만 표시한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); await mockBookApp(page);
    await page.route("**/api/status", route => route.fulfill({ json: { state: "idle", appVersion: "2.15.7" } }));
    await page.evaluate(async () => { nextStatusCheck = 0; await refreshStatus(); });
    await page.evaluate(() => switchWorkspaceTab("settings"));
    assert.equal(await page.locator("#checkAppVersion, #haUpdateLink").count(), 0);
    assert.match(await page.locator("#installedAppVersion").textContent(), /앱 버전: 2.15.7 · 화면 버전: 2.15.7/);
    await page.close();
  }
});

test("취소 클릭이 작업 중 차단되거나 확인창에서 취소되어도 진단은 남고 실제 취소는 보내지 않는다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(), state = await mockBookApp(page);
  const audits = []; let cancelRequests = 0;
  await page.route("**/api/cancel-events", route => { audits.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/reservations/*/cancel", route => { cancelRequests++; return route.fulfill({ json: { ok: true } }); });
  await page.evaluate(() => {
    renderReservations([{ id: "123", room: "솔_산맥존", stayDate: "2026년12월22일", nights: "1박", total: "60,000원", cancelable: true }]);
    busy = true;
    document.querySelector(".reservation-cancel-button").click();
  });
  await page.waitForFunction(() => !cancelAuditPending.length);
  assert.deepEqual(audits.map(item => item.event), ["clicked", "busy"]);
  assert.equal(cancelRequests, 0);
  state.rejectDialogs = true;
  await page.evaluate(() => { busy = false; document.querySelector(".reservation-cancel-button").click(); });
  await page.waitForFunction(() => !busy && !cancelAuditPending.length);
  assert.deepEqual(audits.map(item => item.event), ["clicked", "busy", "clicked", "dismissed"]);
  assert.equal(cancelRequests, 0);
  assert.deepEqual(state.errors, []);
});

test("연결 중단 시 클릭 진단만 임시 저장하고 복구 때 취소 동작 없이 전송한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(); await mockBookApp(page);
  await page.route("**/api/cancel-events", route => route.abort("failed"));
  await page.evaluate(() => recordCancelEvent("clicked", "123"));
  await page.waitForFunction(() => cancelAuditRetryAt > Date.now());
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("swim-cancel-audit")).length), 1);
  let events = 0;
  await page.unroute("**/api/cancel-events");
  await page.route("**/api/cancel-events", route => { events++; return route.fulfill({ json: { ok: true } }); });
  await page.evaluate(async () => { cancelAuditRetryAt = 0; await flushCancelAudit(); });
  assert.equal(events, 1);
  assert.equal(await page.evaluate(() => cancelAuditPending.length), 0);
});
