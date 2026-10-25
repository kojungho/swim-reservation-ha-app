import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { defaultConfig } from "../src/config.js";

test("실제 API에서 조회용 저장·예약용 저장·일정의 한 명 제한·재시작이 독립이며 예약 제출은 하지 않는다", async t => {
  const data = await mkdtemp(path.join(os.tmpdir(), "swim-api-test-"));
  const profiles = ["첫째", "둘째"].map(reserverName => ({ reserverName, depositorName: reserverName, phone: "01012345678", birthDate: "19900101" }));
  const store = new Store(data); await store.init(); await store.saveProfiles(profiles);
  let child;
  async function stop() {
    if (child && child.exitCode === null) {
      const processToStop = child, exited = once(processToStop, "exit");
      const timer = setTimeout(() => processToStop.kill("SIGKILL"), 3000);
      processToStop.kill("SIGTERM");
      try { await exited; } finally { clearTimeout(timer); }
    }
  }
  t.after(async () => { await stop(); await rm(data, { recursive: true, force: true }); });
  async function boot() {
    child = spawn(process.execPath, ["--import", fileURLToPath(new URL("./fixtures/fake-site-time.js", import.meta.url)), fileURLToPath(new URL("../src/server.js", import.meta.url))], { env: { ...process.env, PORT: "0", DATA_DIR: data, CHROMIUM_PATH: "/not-used-in-this-test" }, stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", chunk => { output += chunk; const found = output.match(/(\d+) 포트에서 실행/); if (found) resolve(found[1]); });
      child.stderr.on("data", chunk => { output += chunk; });
      child.once("exit", code => reject(new Error(`서버 종료 ${code}: ${output}`)));
      child.once("error", reject);
    });
    const api = async (endpoint, method = "GET", body) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${endpoint}`, { method, signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      assert.ok(response.ok, JSON.stringify(result));
      return result;
    };
    api.baseUrl = `http://127.0.0.1:${port}/`;
    return api;
  }
  let api = await boot();
  await t.test("최종 제출 간격 API는 0 미사용·1초부터 저장하고 잘못된 값은 기존 값을 보존한다", async () => {
    assert.equal((await api("submission-settings")).intervalSeconds, 5);
    for (const intervalSeconds of [0, 1, 7]) assert.equal((await api("submission-settings", "PUT", { intervalSeconds })).intervalSeconds, intervalSeconds);
    const invalid = await fetch(`${api.baseUrl}api/submission-settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervalSeconds: -1 }) });
    assert.equal(invalid.status, 400); await invalid.json();
    assert.equal((await api("submission-settings")).intervalSeconds, 7);
    await stop(); api = await boot();
    assert.equal((await api("submission-settings")).intervalSeconds, 7);
    await api("submission-settings", "PUT", { intervalSeconds: 5 });
  });
  await t.test("취소 API의 초기 거절과 화면 진단을 기록하고 실제 사이트 취소는 실행하지 않는다", async () => {
    const refused = await fetch(`${api.baseUrl}api/reservations/123/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(refused.status, 400);
    const missing = await fetch(`${api.baseUrl}api/reservations/123/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, profileIndex: 0 }) });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).code, "RESERVATION_SNAPSHOT_REQUIRED");
    const stale = await fetch(`${api.baseUrl}api/reservations/123/cancel`, { method: "POST", headers: { "Content-Type": "application/json", "X-Swim-Client-Version": "2.14.0" }, body: "{}" });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "CLIENT_VERSION_MISMATCH");
    assert.equal((await api("status")).appVersion, "2.15.3");
    const diagnostic = { id: "00000000-0000-4000-8000-000000000123", event: "clicked", reservationId: "123", occurredAt: Date.now() };
    await api("cancel-events", "POST", diagnostic); await api("cancel-events", "POST", diagnostic);
    const logs = (await api("logs")).entries;
    assert.ok(logs.some(item => item.event === "cancel-received"));
    assert.ok(logs.some(item => item.event === "cancel-rejected"));
    assert.ok(logs.some(item => item.details?.code === "RESERVATION_SNAPSHOT_REQUIRED" && item.details.missingFields.join(",") === "room,stayDate,nights"));
    assert.ok(logs.some(item => item.details?.code === "CLIENT_VERSION_MISMATCH" && item.details.clientVersion === "2.14.0" && item.details.serverVersion === "2.15.3"));
    assert.equal(logs.filter(item => item.details?.eventId === diagnostic.id).length, 1);
  });
  assert.equal((await api("month-cache")).intervalMinutes, 60);
  assert.equal((await api("month-cache", "PUT", { intervalMinutes: 0 })).intervalMinutes, 0);
  const html = await (await fetch(api.baseUrl)).text();
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.includes("booking-book.js"));
  for (const file of scripts) {
    const response = await fetch(new URL(file, api.baseUrl));
    assert.equal(response.status, 200, `HTML에서 참조한 ${file}을 실제 서버가 제공해야 합니다.`);
    assert.match(response.headers.get("content-type"), /javascript/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const executablePath = [process.env.CHROMIUM_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium"].filter(Boolean).find(existsSync);
  await t.test("실제 HTTP 서버에서 예약자 관리 파일을 로드하고 탭·선택 목록을 초기화한다", { skip: !executablePath }, async () => {
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(api.baseUrl);
      await page.waitForFunction(() => document.querySelector("#bookingProfileSelect1").options.length === 3);
      await page.locator(".workspace-tabs .active").waitFor({ state: "attached" });
      assert.equal(await page.locator("#reserverName").inputValue(), "");
      await page.locator("#bookingProfileSelect1").selectOption("1");
      assert.equal(await page.locator("#reserverName").inputValue(), "둘째");
      await page.locator("#workspaceMenuButton").click();
      await page.locator('[data-workspace-tab="book"]').click();
      assert.equal(await page.locator("#bookingBookList .booking-book-row").count(), 2);
      await page.locator("#workspaceMenuButton").click();
      await page.locator('[data-workspace-tab="profiles-parallel"]').click();
      assert.equal(await page.locator("#reserverName").inputValue(), "");
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
  const migrated = await api("lookup-profiles");
  await t.test("실제 API로 설정·사진 6개 저장과 선택·전체 삭제를 확인하고 예약 데이터는 변경하지 않는다", async () => {
    const settingsBefore = await api("ui-settings");
    const settings = { ...settingsBefore, serverTime: false, stayRange: true, menuCorner: "bottom-left", mapCorner: "bottom-left", fonts: { ...settingsBefore.fonts, room: 18 } };
    assert.deepEqual(await api("ui-settings", "PUT", settings), settings);
    assert.deepEqual(await api("ui-settings"), settings);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=", "base64");
    for (let index = 0; index < 6; index++) {
      const response = await fetch(`${api.baseUrl}api/site-map`, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
      assert.equal(response.status, 200); await response.json();
    }
    let gallery = await api("site-map/gallery"); assert.equal(gallery.entries.length, 6);
    const full = await fetch(`${api.baseUrl}api/site-map`, { method: "PUT", body: png }); assert.equal(full.status, 409); await full.json();
    const first = gallery.entries[0].id;
    await api(`site-map/gallery/${first}`, "POST", {});
    const photo = await fetch(`${api.baseUrl}api/site-map/gallery/${first}`); assert.equal(photo.headers.get("content-type"), "image/png"); assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
    await stop(); api = await boot();
    assert.deepEqual(await api("ui-settings"), settings);
    gallery = await api("site-map/gallery"); assert.equal(gallery.activeId, first); assert.equal(gallery.entries.length, 6);
    const removed = await api("site-map/gallery", "DELETE", { ids: [first, gallery.entries[1].id] }); assert.equal(removed.entries.length, 4);
    await api("site-map/gallery", "DELETE", { ids: removed.entries.map(entry => entry.id) });
    assert.deepEqual(await api("site-map/gallery"), { entries: [], activeId: null });
    assert.equal((await api("profiles")).profiles.length, 2);
    await api("ui-settings", "PUT", settingsBefore);
  });
  assert.equal(migrated.profiles.length, 2);
  assert.deepEqual(Object.keys(migrated.profiles[0]).sort(), ["phone", "reserverName"]);
  // Missing test browser returns person-specific errors without reaching the site.
  const allChecks = await api("reservations");
  assert.deepEqual(allChecks.lookupStatuses.map(item => item.profileLabel), ["첫째", "둘째"]);
  assert.ok(allChecks.lookupStatuses.every(item => item.error && item.count === undefined));
  const singleLookup = await api("reservations", "POST", { profiles: [{ reserverName: "1회성", phone: "01011112222", birthDate: "19900101" }] });
  assert.equal(singleLookup.lookupStatuses.length, 1);
  assert.deepEqual(singleLookup.lookupStatuses[0].profile, { reserverName: "1회성", phone: "01011112222" });
  assert.equal((await api("profiles")).profiles.length, 2);
  assert.deepEqual((await api("lookup-profiles")).profiles, migrated.profiles);
  const invalidOnce = await fetch(`${api.baseUrl}api/reservations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profiles: [{ reserverName: "잘못된 번호", phone: "123" }] }) });
  assert.equal(invalidOnce.status, 400);
  await invalidOnce.text();
  const config = { ...defaultConfig(), startDate: "2030-12-20", triggerAt: "2030-10-01T00:00:00", roomPriority: [{ name: "해_하늘존", enabled: true }], profiles, multipleProfileIndex: 1 };
  const saved = await api("config", "PUT", config);
  assert.equal(saved.config.profiles.length, 1);
  assert.equal(saved.config.profiles[0].reserverName, "둘째");
  assert.equal(saved.config.editorProfiles.length, 2);
  assert.equal(saved.config.editorProfileIndex, 1);
  await api("lookup-profiles", "PUT", { profiles: [{ reserverName: "조회만", phone: "01099998888", birthDate: "20000101" }] });
  assert.equal((await api("profiles")).profiles[0].reserverName, "첫째");
  assert.equal((await api("config")).profiles[0].reserverName, "둘째");
  await api("profiles", "PUT", { profiles: [profiles[0], { ...profiles[1], reserverName: "둘째 이름 변경", phone: "01055556666" }], selectedIndex: 1 });
  assert.equal((await api("config")).editorProfileIndex, 1);
  assert.equal((await api("config")).profiles[0].reserverName, "둘째");
  assert.deepEqual(Object.keys((await api("lookup-profiles")).profiles[0]).sort(), ["phone", "reserverName"]);
  await api("plans", "POST", { kind: "scheduled", config });
  await api("plans", "POST", { kind: "watch", config, watchEndsAt: "2030-12-20T18:00" });
  assert.equal((await api("plans")).entries[1].watchDeadlineAt, "2030-12-20T18:00:00");
  const editId = (await api("plans")).entries[1].id;
  assert.equal((await api(`plans/${editId}`, "PUT", { name: "감시 수정", kind: "watch", config, intervalSeconds: 180, watchEndsAt: "2030-12-20T18:00" })).id, editId);
  assert.equal((await api("plans")).entries.length, 2);
  assert.equal((await api("plans")).entries[1].intervalSeconds, 180);
  const invalidDeadline = await fetch(new URL("api/plans", api.baseUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "watch", config, watchEndsAt: "2030-02-30T18:00" }) });
  assert.equal(invalidDeadline.status, 400);
  assert.equal((await api("plans")).entries[0].config.profiles.length, 1);
  assert.equal((await api("status")).state, "idle");
  await api("lookup-profiles", "PUT", { profiles: [] });
  await stop(); api = await boot();
  assert.equal((await api("month-cache")).intervalMinutes, 0);
  assert.deepEqual((await api("lookup-profiles")).profiles, []);
  assert.equal((await api("config")).editorProfileIndex, 1);
  assert.equal((await api("plans")).entries[0].enabled, false);
  assert.equal((await api("plans")).entries[1].watchEndsAt, "2030-12-20T18:00:00");
  await api("profiles", "PUT", { profiles: [] });
  await api("config", "PUT", { ...config, profiles: [{ ...profiles[0], reserverName: "일정만 저장한 사람" }], multipleProfileIndex: 0 });
  assert.deepEqual((await api("profiles")).profiles, []);
  assert.equal((await api("plans")).entries[0].config.profiles[0].reserverName, "둘째");
  await stop(); api = await boot();
  assert.deepEqual((await api("profiles")).profiles, []);
  assert.deepEqual((await api("lookup-profiles")).profiles, []);
  const twentyPeople = Array.from({ length: 20 }, (_, index) => ({ reserverName: `예약자${index + 1}`, depositorName: `입금자${index + 1}`, phone: `01012345${String(index).padStart(3, "0")}`, birthDate: "19900101" }));
  await api("profiles", "PUT", { profiles: twentyPeople, selectedIndex: 19 });
  assert.equal((await api("profiles")).profiles.length, 20);
  const tooMany = await fetch(new URL("api/profiles", api.baseUrl), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profiles: [...twentyPeople, twentyPeople[0]] }) });
  assert.equal(tooMany.status, 400); await tooMany.text();
  await stop(); api = await boot();
  assert.equal((await api("profiles")).profiles.length, 20);
  assert.equal((await api("config")).editorProfileIndex, 19);
});
