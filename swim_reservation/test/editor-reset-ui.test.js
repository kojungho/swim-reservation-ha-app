import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { defaultConfig, normalizeConfig } from "../src/config.js";

const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
test("PC·폰의 일정 입력은 등록 성공·탭 이동 시 초기화하고 실패·새 편집·명시적 불러오기는 보존한다", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [], writes = [], plans = [];
    let rejectRegistration = false, gate = null, arrived = false;
    const saved = { reserverName: "저장된예약자", depositorName: "저장된입금자", phone: "01012345678", birthDate: "19900101" };
    const config = normalizeConfig({ ...defaultConfig(), startDate: "2026-12-20", profiles: [saved], roomPriority: [{ name: "해_하늘존", enabled: true }, { name: "달_하늘존", enabled: false }] });
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://app.test/**", async route => {
      const req = route.request(), endpoint = new URL(req.url()).pathname;
      if (!endpoint.startsWith("/api/")) {
        const file = endpoint === "/" ? "index.html" : endpoint.slice(1);
        return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../public/${file}`, import.meta.url)) });
      }
      if (req.method() !== "GET") writes.push(endpoint);
      let result;
      if (endpoint === "/api/config") result = config;
      else if (endpoint === "/api/profiles") result = { profiles: [saved] };
      else if (endpoint === "/api/lookup-profiles") result = { profiles: [{ reserverName: saved.reserverName, phone: saved.phone }] };
      else if (endpoint === "/api/plans" && req.method() === "POST") {
        const input = req.postDataJSON();
        arrived = true;
        if (gate) await gate;
        if (rejectRegistration) return route.fulfill({ status: 400, json: { error: "등록 실패 테스트" } });
        const id = `00000000-0000-0000-0000-${String(plans.length + 1).padStart(12, "0")}`;
        plans.push({ ...input, id, enabled: false, status: { state: "idle", message: "설정 완료" } });
        result = { id };
      } else if (endpoint === "/api/plans") result = { entries: plans };
      else if (endpoint === "/api/reservations") result = { reservations: [], lookupErrors: [] };
      else result = { entries: [], rooms: [], state: "idle", stage: "idle", synced: true, serverNowMs: Date.now(), lastSyncedAt: Date.now() };
      return route.fulfill({ json: result });
    });
    const cleared = async () => {
      for (const id of ["planName", "startDate", "triggerAt", "reserverName", "depositorName", "phone", "birthDate"]) assert.equal(await page.locator(`#${id}`).inputValue(), "", id);
      assert.equal(await page.locator("#nights").inputValue(), "1");
      assert.equal(await page.locator("#roomList input:checked").count(), 0);
      assert.equal(await page.locator("#multipleProfileSelect option").count(), 1);
    };
    const fill = async name => {
      await page.locator("#planName").fill(name);
      await page.locator("#startDate").fill("2026-12-21");
      await page.locator("#triggerAt").fill("2026-10-20T00:00");
      await page.locator("#nights").selectOption("3");
      await page.locator("#reserverName").fill("새예약자");
      await page.locator("#depositorName").fill("새입금자");
      await page.locator("#phone").fill("01023456789");
      await page.locator("#birthDate").fill("19910101");
      await page.locator("#roomList input[type=checkbox]").first().check();
    };
    await page.goto("https://app.test/");
    await page.locator(".workspace-tabs .active").waitFor();
    await fill("등록할 일정");
    await page.locator("#addPlanButton").click();
    await page.waitForFunction(() => document.querySelector("#planMessage").textContent.includes("입력란을 초기화"));
    await cleared();
    assert.equal(plans[0].name, "등록할 일정");
    assert.equal(plans[0].config.startDate, "2026-12-21");
    assert.equal(plans[0].config.nights, 3);
    assert.equal(plans[0].config.profiles[0].reserverName, "새예약자");
    assert.equal(plans[0].config.roomPriority[0].enabled, true);

    await fill("등록 실패 일정");
    rejectRegistration = true;
    await page.locator("#addPlanButton").click();
    await page.waitForFunction(() => document.querySelector("#planMessage").textContent.includes("등록 실패 테스트"));
    assert.equal(await page.locator("#planName").inputValue(), "등록 실패 일정");
    assert.equal(await page.locator("#startDate").inputValue(), "2026-12-21");
    assert.equal(await page.locator("#nights").inputValue(), "3");
    assert.equal(plans.length, 1);
    rejectRegistration = false;
    await page.locator('[data-workspace-tab="priority"]').click();
    assert.equal(await page.locator("#planName").inputValue(), "등록 실패 일정");
    await page.locator('[data-workspace-tab="multiple"]').click();
    await cleared();
    await page.locator('[data-workspace-tab="priority"]').click();
    await cleared();
    await page.locator("#planList .plan-entry").first().getByRole("button", { name: "설정 불러오기", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#planName").value === "등록할 일정");
    assert.equal(await page.locator("#reserverName").inputValue(), "새예약자");
    assert.equal(await page.locator("#startDate").inputValue(), "2026-12-21");
    await page.locator('[data-workspace-tab="people"]').click();
    await page.waitForFunction(() => document.querySelector("#lookupreserverName1")?.value === "저장된예약자");
    await page.locator('[data-workspace-tab="profiles-parallel"]').click();
    await page.locator("#addProfileButton").click();
    await page.locator("#reserverName2").fill("미등록 두번째");
    await page.locator('[data-workspace-tab="watch"]').click();
    await cleared();
    await page.locator("#watchInterval").fill("120");
    await page.locator('[data-workspace-tab="priority"]').click();
    assert.equal(await page.locator("#watchInterval").inputValue(), "60");
    await page.locator("#loadProfilesButton").click();
    await page.waitForFunction(() => document.querySelector("#reserverName").value === "저장된예약자");
    assert.equal(await page.locator("#depositorName").inputValue(), "저장된입금자");

    // A delayed response must not erase the next draft edited in another tab.
    await fill("응답 대기 일정");
    let release;
    gate = new Promise(resolve => { release = resolve; });
    arrived = false;
    await page.locator("#addPlanButton").click();
    await page.waitForFunction(() => document.querySelector("#addPlanButton").disabled);
    for (let attempt = 0; !arrived && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(arrived, true);
    await page.locator('[data-workspace-tab="multiple"]').click();
    await page.locator("#planName").fill("다음 일정");
    release();
    await page.waitForFunction(() => document.querySelector("#planMessage").textContent.includes("새로 편집한"));
    assert.equal(await page.locator("#planName").inputValue(), "다음 일정");
    assert.equal(plans[1].name, "응답 대기 일정");
    assert.equal(plans[1].config.bookingMode, "priority");
    assert.equal(plans.length, 2);
    assert.deepEqual(writes.filter(endpoint => endpoint !== "/api/inspect"), ["/api/plans", "/api/plans", "/api/plans"]);
    assert.deepEqual(errors, []);
    await page.close();
  }
});
