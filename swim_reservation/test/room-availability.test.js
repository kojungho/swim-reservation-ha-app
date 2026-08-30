import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { ReservationEngine } from "../src/reservation-engine.js";

const executablePath = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean).find(existsSync);

test("비활성화된 객실은 박수 옵션이 있어도 예약 완료로 표시한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const engine = new ReservationEngine({ store: {} });
    engine.page = page;
    await page.setContent(`
      <table>
        <tr><td><input type="checkbox" name="room_rid[0]"></td><td>해_하늘존</td><td><select name="daytype[0]"><option value="1">1박</option></select></td></tr>
        <tr><td><input type="checkbox" name="room_rid[1]" disabled></td><td>달_하늘존</td><td><select name="daytype[1]"><option value="1">1박</option></select></td></tr>
        <tr><td><input type="checkbox" name="room_rid[2]"></td><td>별_하늘존</td><td><select name="daytype[2]"><option value="2">2박</option></select></td></tr>
      </table>`);

    const rooms = await engine.readRooms(1);
    assert.deepEqual(rooms.map(({ name, available, status }) => ({ name, available, status })), [
      { name: "해_하늘존", available: true, status: "available" },
      { name: "달_하늘존", available: false, status: "booked" },
      { name: "별_하늘존", available: false, status: "unavailable" }
    ]);
  } finally {
    await browser.close();
  }
});
