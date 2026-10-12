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
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
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
      const response = await fetch(`http://127.0.0.1:${port}/api/${endpoint}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      assert.ok(response.ok, JSON.stringify(result));
      return result;
    };
    api.baseUrl = `http://127.0.0.1:${port}/`;
    return api;
  }
  let api = await boot();
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
      await page.locator(".workspace-tabs .active").waitFor();
      assert.equal(await page.locator("#reserverName").inputValue(), "");
      await page.locator("#bookingProfileSelect1").selectOption("1");
      assert.equal(await page.locator("#reserverName").inputValue(), "둘째");
      await page.locator('[data-workspace-tab="book"]').click();
      assert.equal(await page.locator("#bookingBookList .booking-book-row").count(), 2);
      await page.locator('[data-workspace-tab="profiles-parallel"]').click();
      assert.equal(await page.locator("#reserverName").inputValue(), "");
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
  const migrated = await api("lookup-profiles");
  assert.equal(migrated.profiles.length, 2);
  assert.deepEqual(Object.keys(migrated.profiles[0]).sort(), ["phone", "reserverName"]);
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
  assert.equal((await api("plans")).entries[0].config.profiles.length, 1);
  assert.equal((await api("status")).state, "idle");
  await api("lookup-profiles", "PUT", { profiles: [] });
  await stop(); api = await boot();
  assert.deepEqual((await api("lookup-profiles")).profiles, []);
  assert.equal((await api("config")).editorProfileIndex, 1);
  assert.equal((await api("plans")).entries[0].enabled, false);
  await api("profiles", "PUT", { profiles: [] });
  await api("config", "PUT", { ...config, profiles: [{ ...profiles[0], reserverName: "일정만 저장한 사람" }], multipleProfileIndex: 0 });
  assert.deepEqual((await api("profiles")).profiles, []);
  assert.equal((await api("plans")).entries[0].config.profiles[0].reserverName, "둘째");
  await stop(); api = await boot();
  assert.deepEqual((await api("profiles")).profiles, []);
  assert.deepEqual((await api("lookup-profiles")).profiles, []);
});
