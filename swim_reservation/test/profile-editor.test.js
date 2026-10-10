import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { defaultConfig, normalizeConfig } from "../src/config.js";

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean).find(existsSync);
test("모바일에서 기존 2명을 불러와 5명 추가·저장·복원·중간 삭제", { skip: !executablePath }, async t => {
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let config = { ...defaultConfig(), useSecondProfile: true, profile2: { reserverName: "기존두번째", depositorName: "입금자2", phone: "01012345678", birthDate: "19900101" } };
  await page.route("https://app.test/**", async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname;
    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/config" && req.method() === "PUT") config = normalizeConfig(req.postDataJSON());
      const data = pathname === "/api/config" ? (req.method() === "PUT" ? { config } : config)
        : pathname === "/api/status" ? { state: "idle", stage: "idle" }
        : { entries: [], rooms: [], synced: true, serverNowMs: Date.now(), lastSyncedAt: Date.now(), offsetMs: 0, rttMs: 1 };
      return route.fulfill({ json: data });
    }
    const file = pathname === "/" ? "index.html" : pathname.slice(1);
    return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../public/${file}`, import.meta.url)) });
  });
  await page.goto("https://app.test/");
  await page.locator("#reserverName2").waitFor();
  assert.equal(await page.locator("#reserverName2").inputValue(), "기존두번째");
  for (let n = 3; n <= 5; n++) {
    await page.locator("#addProfileButton").click();
    await page.locator(`#reserverName${n}`).fill(`예약자${n}`);
    await page.locator(`#depositorName${n}`).fill(`입금자${n}`);
    await page.locator(`#phone${n}`).fill(`0101234567${n}`);
    await page.locator(`#birthDate${n}`).fill("19900101");
  }
  assert.equal(await page.locator("#addProfileButton").isDisabled(), true);
  await page.locator("#saveButton").click();
  await page.waitForFunction(() => document.body.innerText.includes("설정을 HA 미니 PC에 저장했습니다."));
  assert.equal(config.profiles.length, 5);
  await page.reload();
  await page.locator("#reserverName5").waitFor();
  assert.equal(await page.locator("#reserverName5").inputValue(), "예약자5");
  page.on("dialog", d => d.accept());
  await page.locator("#extraProfiles .second-profile-panel").nth(1).locator("button").click();
  assert.equal(await page.locator("#reserverName3").inputValue(), "예약자4");
  assert.equal(await page.locator("#reserverName4").inputValue(), "예약자5");
  assert.equal(await page.locator("#addProfileButton").isDisabled(), false);
  await page.locator("#saveButton").click();
  await page.waitForFunction(() => document.body.innerText.includes("설정을 HA 미니 PC에 저장했습니다."));
  assert.equal(config.profiles.length, 4);
});
