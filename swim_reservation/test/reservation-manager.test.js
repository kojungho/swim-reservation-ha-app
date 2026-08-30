import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { ReservationManager, readReservationsFromPage } from "../src/reservation-manager.js";

const executablePath = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean).find(existsSync);

test("예약 확인 페이지의 실제 예약 행과 취소 식별값을 읽는다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<table><tr><td>숨_산맥존</td><td>2026년10월07일</td><td>1박</td><td>30평</td><td>2명/0명</td><td>60,000원</td><td>0원</td><td>60,000원</td><td>예약대기 중<br><a href="javascript:del_ok1('493304');">취소하기</a></td></tr></table>`);
    assert.deepEqual(await page.evaluate(readReservationsFromPage), [{
      id: "493304", room: "숨_산맥존", stayDate: "2026년10월07일", nights: "1박", size: "30평",
      guests: "2명/0명", fee: "60,000원", extraFee: "0원", total: "60,000원",
      status: "예약대기 중", cancelable: true
    }]);
  } finally {
    await browser.close();
  }
});

test("취소 전후에 예약 목록을 확인하고 대상이 사라져야 완료로 판정한다", async () => {
  const manager = new ReservationManager();
  const navigations = [];
  const target = { id: "493304", room: "숨_산맥존", cancelable: true };
  let loadCount = 0;
  manager.withPage = async (action) => action({ goto: async (url) => navigations.push(url) });
  manager.load = async () => loadCount++ === 0 ? [target] : [];

  const result = await manager.cancel({ reserverName: "고중호", phone: "01074302277" }, "493304");

  assert.deepEqual(result, { canceled: target, reservations: [] });
  assert.match(navigations[0], /order_del3\.php\?no=493304/);
});
