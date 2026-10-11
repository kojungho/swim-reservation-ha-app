import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { defaultConfig, normalizeConfig } from "../src/config.js";
const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("PC·폰에서 모드별 탭·다중 일정 등록·개별 시작과 중지·페이지 진입 조회·이번 달 달력을 지원한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.clock.setFixedTime(new Date("2026-10-12T10:00:00+09:00"));
    const errors = [], plans = [], commands = [], months = [];
    let lookups = 0;
    const profile = { reserverName: "테스트예약자", depositorName: "테스트", phone: "01012345678", birthDate: "19900101" };
    const config = normalizeConfig({ ...defaultConfig(), startDate: "2026-12-20", profiles: [profile], roomPriority: [{ name: "해_하늘존", enabled: true }] });
    page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.route("https://app.test/**", async route => {
      const req = route.request(), url = new URL(req.url()), endpoint = url.pathname;
      if (!endpoint.startsWith("/api/")) {
        const file = endpoint === "/" ? "index.html" : endpoint.slice(1);
        return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../public/${file}`, import.meta.url)) });
      }
      let result;
      if (endpoint === "/api/config") result = config;
      else if (endpoint === "/api/profiles") result = { profiles: [profile] };
      else if (endpoint === "/api/lookup-profiles") result = { profiles: [{ reserverName: profile.reserverName, phone: profile.phone }] };
      else if (endpoint === "/api/plans" && req.method() === "POST") {
        const input = req.postDataJSON();
        const id = `00000000-0000-0000-0000-${String(plans.length + 1).padStart(12, "0")}`;
        plans.push({ ...input, id, enabled: false, status: { state: "idle", message: "설정 완료" } });
        result = { id };
      } else if (endpoint === "/api/plans") result = { entries: plans };
      else if (endpoint.startsWith("/api/plans/")) {
        commands.push(endpoint);
        const plan = plans.find(item => endpoint.includes(item.id));
        if (plan) { plan.enabled = endpoint.endsWith("/start"); plan.status = { state: plan.enabled ? "waiting" : "stopped", message: plan.enabled ? "예약 대기" : "중지" }; }
        result = { ok: true };
      } else if (endpoint === "/api/reservations") { lookups++; result = { reservations: [], lookupErrors: [] }; }
      else if (endpoint === "/api/monthly-availability") {
        const month = url.searchParams.get("month"); months.push(month);
        result = { month, roomNames: ["해_하늘존"], opensAt: "2026-08-01T00:00:00", beforeOpen: false, capturedAt: Date.now(), days: [{ date: `${month}-01`, rooms: [{ name: "해_하늘존", status: "available" }] }] };
      } else result = { entries: [], rooms: [], state: "idle", stage: "idle", synced: true, serverNowMs: Date.now(), lastSyncedAt: Date.now() };
      return route.fulfill({ json: result });
    });
    await page.goto("https://app.test/");
    await page.locator(".workspace-tabs .active").waitFor();
    assert.equal(await page.locator("#addProfileButton").isVisible(), false);
    assert.equal(await page.locator("#firstBookingProfileFields").isVisible(), true);
    await page.locator("#planName").fill("첫 일정");
    await page.locator("#addPlanButton").click();
    await page.locator("#planList .plan-entry").waitFor();
    await page.locator('[data-workspace-tab="multiple"]').click();
    assert.equal(await page.locator("#addProfileButton").isVisible(), false);
    assert.equal(await page.locator("#roomList .room-drag-handle").count(), 0);
    await page.locator("#startDate").fill("2026-12-21");
    await page.locator("#planName").fill("두번째 일정");
    await page.locator("#addPlanButton").click();
    await page.waitForFunction(() => document.querySelectorAll("#planList .plan-entry").length === 2);
    assert.equal(plans[0].config.bookingMode, "priority");
    assert.equal(plans[0].config.startDate, "2026-12-20");
    assert.equal(plans[1].config.bookingMode, "multiple");
    await page.locator("#planList .plan-entry").first().getByRole("button", { name: "시작", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#planList .plan-entry").innerText.includes("진행 중"));
    await page.locator("#planList .plan-entry").nth(1).getByRole("button", { name: "시작", exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("#planList .plan-entry")].every(item => item.innerText.includes("진행 중")));
    await page.locator("#planList .plan-entry").first().getByRole("button", { name: "중지", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#planList .plan-entry").innerText.includes("중지/종료"));
    assert.equal(plans[1].enabled, true);
    await page.locator('[data-workspace-tab="watch"]').click();
    assert.equal(await page.locator("#watchHelp").isVisible(), true);
    assert.equal(await page.locator("#bookingMode").isVisible(), false);
    assert.equal(await page.locator("#triggerAt").isVisible(), false);
    assert.equal(await page.locator("#watchProfileSelect").isVisible(), true);
    assert.equal(await page.locator("#roomList .room-drag-handle").count(), 0);
    assert.equal(await page.locator("#roomList .room-rank").count(), 0);
    assert.match(await page.locator("#roomSectionTitle").innerText(), /감시할 객실/);
    await page.locator("#addPlanButton").click();
    await page.waitForFunction(() => document.querySelectorAll("#planList .plan-entry").length === 3);
    assert.equal(plans[2].kind, "watch");
    assert.equal(plans[2].config.bookingMode, "priority");
    assert.equal(plans[2].watchProfileIndex, 0);
    await page.locator('[data-workspace-tab="people"]').click();
    await page.waitForFunction(() => !document.querySelector("#reservationList").hidden);
    assert.equal(lookups, 1);
    assert.equal(await page.locator("#saveLookupProfilesButton").isVisible(), true);
    assert.equal(await page.locator("#saveProfilesButton").isVisible(), false);
    assert.equal(await page.locator("#startDate").isVisible(), false);
    assert.equal(await page.locator("#lookupProfileList input").count(), 2);
    assert.doesNotMatch(await page.locator("#lookupCard").innerText(), /입금자명 입력|생년월일 입력/);
    await page.locator('[data-workspace-tab="profiles-parallel"]').click();
    assert.equal(await page.locator("#addProfileButton").isVisible(), true);
    assert.equal(await page.locator("#bookingMode").isVisible(), false);
    assert.equal(await page.evaluate(() => {
      const profile = document.querySelector("#reserverName").closest("section");
      const rooms = document.querySelector("#profilePriorities").closest("section");
      return Boolean(profile.compareDocumentPosition(rooms) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), true);
    await page.locator('[data-workspace-tab="monthly"]').click();
    await page.waitForFunction(() => document.querySelector("#monthlyStatus").textContent.includes("조회 완료"));
    assert.deepEqual(months, ["2026-10"]);
    await page.locator('[data-date="2026-10-01"]').click();
    await page.waitForFunction(() => document.activeElement.id === "startDate");
    assert.equal(await page.locator("#startDate").inputValue(), "2026-10-01");
    assert.equal(await page.locator(".workspace-tabs").evaluate(el => el.scrollWidth <= el.clientWidth), true);
    if (width === 390) await page.screenshot({ path: "/tmp/swim-profiles.6W9Acs/workspace-mobile.png", fullPage: true });
    assert.equal(commands.filter(command => command.endsWith("/start")).length, 2);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
