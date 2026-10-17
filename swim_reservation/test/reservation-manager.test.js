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
  manager.withPage = async (action) => action({});
  manager.clickCancellation = async (_page, id) => navigations.push(id);
  manager.load = async () => loadCount++ === 0 ? [target] : [];

  const result = await manager.cancel({ reserverName: "한가람", phone: "01011112222" }, "493304");

  assert.deepEqual(result, { canceled: target, reservations: [] });
  assert.equal(navigations[0], "493304");
});

test("재조회한 대상이 변경되거나 중복이면 취소 요청을 보내지 않는다", async () => {
  const manager = new ReservationManager();
  manager.withPage = async action => action({});
  manager.clickCancellation = async () => assert.fail("취소 요청 금지");
  const target = { id: "123", room: "솔_산맥존", stayDate: "2026년12월22일", nights: "1박", cancelable: true };
  manager.load = async () => [target];
  await assert.rejects(() => manager.cancel({}, "123", { ...target, nights: "2박" }), /변경/);
  manager.load = async () => [target, target];
  await assert.rejects(() => manager.cancel({}, "123"), /찾지 못/);
});

test("취소 요청 후 대상이 남거나 확인 페이지가 비정상이면 완료로 처리하지 않는다", async () => {
  const manager = new ReservationManager();
  manager.withPage = async action => action({});
  manager.clickCancellation = async () => {};
  const target = { id: "123", cancelable: true };
  manager.load = async () => [target];
  await assert.rejects(() => manager.cancel({}, "123"), /취소 완료를 확인하지 못/);
  const values = [true, [], false];
  await assert.rejects(() => new ReservationManager().load({ goto: async () => ({ ok: () => true }), evaluate: async () => values.shift() }, { reserverName: "한가람", phone: "01011112222" }), /0건으로 판단하지 않습니다/);
});

test("취소는 원본 버튼의 동작을 사용하고 대상 소멸을 재조회한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    await page.route("**/*", async route => {
      requests.push(new URL(route.request().url()).pathname);
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: requests.length > 1 ? "취소 완료" : `<table><tr><td><a href="javascript:del_ok1('123')">취소하기</a></td></tr></table><script>function del_ok1(id){if(confirm('해당 예약을 취소하시겠습니까?'))location.href='order_del2.php?no='+id}</script>` });
    });
    await page.goto("http://example.test/reservation/order_ok7.php");
    const manager = new ReservationManager();
    await manager.clickCancellation(page, "123");
    assert.deepEqual(requests, ["/reservation/order_ok7.php", "/reservation/order_del2.php"]);
  } finally { await browser.close(); }
});

test("모의 조회부터 취소·재조회까지 실제 DOM과 연결하고 다른 예약은 유지한다", { skip: !executablePath }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    let canceled = false;
    const deleted = [];
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      let body;
      if (url.pathname.endsWith("order_del2.php")) {
        deleted.push(url.searchParams.get("no"));
        canceled = true;
        body = "취소 완료";
      } else {
        const row = id => `<tr><td>솔_산맥존</td><td>2026년12월22일</td><td>1박</td><td>30평</td><td>2명</td><td>0명</td><td>60,000원</td><td>0원</td><td>60,000원</td><td><a href="javascript:del_ok1('${id}')">취소하기</a></td></tr>`;
        body = `<h1>예약 확인</h1><table>${canceled ? "" : row("123")}${row("456")}</table><script>function del_ok1(id){if(confirm('해당 예약을 취소하시겠습니까?'))location.href='order_del2.php?no='+id}</script>`;
      }
      await route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
    const manager = new ReservationManager();
    manager.withPage = async action => action(page);
    const result = await manager.cancel({ reserverName: "한가람", phone: "01011112222" }, "123", { room: "솔_산맥존", stayDate: "2026년12월22일", nights: "1박" });
    assert.deepEqual(deleted, ["123"]);
    assert.deepEqual(result.reservations.map(row => row.id), ["456"]);
  } finally { await browser.close(); }
});
