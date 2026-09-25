import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { chromium } from "playwright-core";
import { SiteMap } from "../src/site-map.js";
import { defaultConfig } from "../src/config.js";

const executablePath = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean).find(existsSync);

test("PC·모바일 안내 창에서 JPG 선택 후 등록하고 다시 열어 표시한다", { skip: !executablePath }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "swim-map-ui-"));
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(async () => { await browser.close(); await rm(dir, { recursive: true, force: true }); });
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const photo = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 300; canvas.height = 200;
      canvas.getContext("2d").fillRect(0, 0, 300, 200);
      return { jpg: canvas.toDataURL("image/jpeg").split(",")[1], png: canvas.toDataURL().split(",")[1] };
    });
    const fallback = path.join(dir, "default.png");
    await writeFile(fallback, Buffer.from(photo.png, "base64"));
    const map = new SiteMap(dir, fallback);
    let uploads = 0;
    await page.route("https://app.test/**", async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname.replace("/ingress/test", "");
      if (pathname === "/api/site-map") {
        if (request.method() === "PUT") {
          await map.save(Readable.from([request.postDataBuffer()])); uploads++;
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ contentType: "image/png", body: await map.read() });
      }
      if (pathname.startsWith("/api/")) {
        const data = pathname.endsWith("config") ? defaultConfig()
          : pathname.endsWith("status") ? { state: "idle", stage: "idle" }
          : { entries: [], rooms: [], synced: true, serverNowMs: Date.now(), lastSyncedAt: Date.now(), offsetMs: 0, rttMs: 1 };
        return route.fulfill({ json: data });
      }
      const filename = pathname === "/" ? "index.html" : pathname.slice(1);
      const type = filename.endsWith("js") ? "text/javascript" : filename.endsWith("css") ? "text/css" : "text/html";
      return route.fulfill({ contentType: type, body: await readFile(new URL(`../public/${filename}`, import.meta.url)) });
    });
    await page.goto("https://app.test/ingress/test/");
    await page.locator("#siteMapButton").click();
    await page.locator("#siteMapFile").setInputFiles({ name: "휴대폰사진.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo.jpg, "base64") });
    await page.waitForFunction(() => document.getElementById("siteMapMessage").textContent.startsWith("사진을 등록했습니다."));
    assert.equal(uploads, 1);
    await page.locator("#siteMapCloseButton").click();
    await page.locator("#siteMapButton").click();
    await page.waitForFunction(() => document.getElementById("siteMapImage").naturalWidth === 300);
    assert.equal(await page.locator("#siteMapDialog").evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.close();
  }
});
