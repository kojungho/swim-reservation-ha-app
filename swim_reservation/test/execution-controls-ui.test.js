import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { defaultConfig, normalizeConfig } from "../src/config.js";

const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("PC·폰에서 일정 목록을 실행 영역 아래에 두고 미래 예약·감시는 등록 후 시작하며 즉시 버튼은 서버 시간에 맞춰 표시한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [], plans = [], starts = [];
    let synced = true;
    let now = Date.parse("2026-10-12T10:00:00+09:00");
    const profile = { reserverName: "테스트예약자", depositorName: "테스트", phone: "01012345678", birthDate: "19900101" };
    let config = normalizeConfig({ ...defaultConfig(), startDate: "2026-12-20", triggerAt: "2026-10-12T11:00:00", profiles: [profile], roomPriority: [{ name: "해_하늘존", enabled: true }] });
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.route("https://app.test/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname;
      if (!path.startsWith("/api/")) {
        const file = path === "/" ? "index.html" : path.slice(1);
        return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../public/${file}`, import.meta.url)) });
      }
      let result;
      if (path === "/api/config") {
        if (req.method() === "PUT") { config = normalizeConfig(req.postDataJSON()); result = { config }; }
        else result = config;
      } else if (path === "/api/profiles") result = { profiles: [profile] };
      else if (path.startsWith("/api/site-time")) result = { synced, serverNowMs: now, lastSyncedAt: now, offsetMs: 0, rttMs: 0, error: "동기화 실패 테스트" };
      else if (path === "/api/plans" && req.method() === "POST") {
        const id = `00000000-0000-0000-0000-${String(plans.length + 1).padStart(12, "0")}`;
        plans.push({ ...req.postDataJSON(), id, enabled: false, status: { state: "idle", message: "등록" } });
        result = { id };
      } else if (path === "/api/plans") result = { entries: plans };
      else if (path.endsWith("/start")) { starts.push(path); result = { ok: true }; }
      else result = { entries: [], rooms: [], state: "idle", stage: "idle" };
      return route.fulfill({ json: result });
    });
    await page.goto("https://app.test/");
    await page.locator(".workspace-tabs .active").waitFor();
    await page.waitForFunction(() => document.querySelector("#siteTimeMeta").textContent.includes("정상"));
    assert.equal(await page.locator("#startButton").count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector("#runNowButton").closest("section").nextElementSibling.id), "planCard");
    assert.equal(await page.locator("#runNowButton").isVisible(), false);
    await page.locator("#planName").fill("미래 일정");
    await page.locator("#addPlanButton").click();
    await page.locator("#planList .plan-entry").waitFor();
    assert.equal(plans[0].kind, "scheduled");
    assert.deepEqual(starts, []);
    await page.locator("#planList .plan-entry").first().getByRole("button", { name: "시작", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#planMessage").textContent.includes("시작 완료"));
    assert.equal(starts.length, 1);
    await page.locator('[data-workspace-tab="watch"]').click();
    assert.equal(await page.locator("#runNowButton").isVisible(), false);
    await page.locator("#planName").fill("취소 자리 일정");
    await page.locator("#addPlanButton").click();
    await page.waitForFunction(() => document.querySelectorAll("#planList .plan-entry").length === 2);
    assert.equal(plans[1].kind, "watch");
    assert.equal(starts.length, 1);
    await page.locator("#planList .plan-entry").nth(1).getByRole("button", { name: "시작", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#planMessage").textContent.includes("취소 자리 일정: 시작 완료"));
    assert.equal(starts.length, 2);
    await page.locator('[data-workspace-tab="priority"]').click();
    await page.locator("#startDate").fill("2026-12-20");
    await page.locator("#triggerAt").fill("2026-10-12T09:00");
    await page.locator("#runNowButton").waitFor({ state: "visible" });
    await page.locator("#triggerAt").fill("2026-10-12T11:00");
    assert.equal(await page.locator("#runNowButton").isVisible(), false);
    now = Date.parse("2026-10-12T11:00:00+09:00");
    await page.locator("#siteTimeSyncButton").click();
    await page.locator("#runNowButton").waitFor({ state: "visible" });
    synced = false;
    await page.locator("#siteTimeSyncButton").click();
    await page.locator("#runNowButton").waitFor({ state: "hidden" });
    // Even dispatching a hidden button cannot bypass the execution-time check.
    await page.locator("#runNowButton").evaluate(button => button.click());
    await page.waitForFunction(() => document.querySelector("#statusText").textContent.includes("서버 시간도 확인"));
    assert.equal(plans.length, 2);
    assert.equal(starts.length, 2);
    synced = true;
    await page.locator("#siteTimeSyncButton").click();
    await page.locator("#runNowButton").waitFor({ state: "visible" });
    await page.locator("#startDate").fill("2027-01-20");
    await page.locator("#triggerAt").fill("2026-10-12T09:00");
    assert.equal(await page.locator("#runNowButton").isVisible(), false);
    await page.locator("#startDate").fill("2026-12-20");
    await page.locator("#triggerAt").fill("2026-10-12T09:00");
    await page.locator("#loadProfilesButton").click();
    await page.waitForFunction(() => document.querySelector("#reserverName").value === "테스트예약자");
    await page.locator("#roomList input[type=checkbox]").first().check();
    await page.locator("#runNowButton").click();
    await page.waitForFunction(() => document.querySelector("#planMessage").textContent.includes("독립 일정으로 실행"));
    assert.equal(plans.length, 3);
    assert.equal(plans[2].kind, "now");
    assert.equal(starts.length, 3);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
