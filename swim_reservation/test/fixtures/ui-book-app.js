import { readFile } from "node:fs/promises";
import { defaultConfig, normalizeConfig, normalizeProfile } from "../../src/config.js";

export const testGuest = (number = 1) => ({ reserverName: `저장예약자${number}`, depositorName: `입금자${number}`, phone: number < 10 ? `0101234567${number}` : `010123456${String(number).padStart(2, "0")}`, birthDate: "19900101" });
export async function mockBookApp(page, count = 2) {
  const state = { book: Array.from({ length: count }, (_, index) => testGuest(index + 1)), lookupBook: [], plans: [], planCalls: [], dialogs: [], writes: [], errors: [], rejectBook: false, logsRead: 0 };
  if (state.book.length) state.book[0].roomPriority = [{ name: "달_하늘존", enabled: true }];
  state.config = normalizeConfig({ ...defaultConfig(), startDate: "2026-12-20", triggerAt: "2026-10-20T00:00:00", profiles: state.book, roomPriority: [{ name: "해_하늘존", enabled: false }, { name: "달_하늘존", enabled: false }] });
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("dialog", dialog => { state.dialogs.push(dialog.message()); return state.rejectDialogs ? dialog.dismiss() : dialog.accept(); });
  await page.route("https://app.test/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (!path.startsWith("/api/")) {
      const file = path === "/" ? "index.html" : path.slice(1);
      return route.fulfill({ contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html", body: await readFile(new URL(`../../public/${file}`, import.meta.url)) });
    }
    if (req.method() !== "GET") state.writes.push(path);
    let result;
    if (path === "/api/config") {
      if (req.method() === "PUT") state.config = normalizeConfig(req.postDataJSON());
      result = req.method() === "PUT" ? { config: state.config } : state.config;
    } else if (path === "/api/profiles") {
      if (req.method() === "PUT") {
        if (state.rejectBook) return route.fulfill({ status: 400, json: { error: "저장 실패 테스트" } });
        state.book = req.postDataJSON().profiles.map(normalizeProfile);
      }
      result = { profiles: state.book };
    } else if (path === "/api/lookup-profiles") {
      if (req.method() === "PUT") state.lookupBook = req.postDataJSON().profiles;
      result = { profiles: state.lookupBook };
    } else if (path === "/api/inspect") result = { rooms: state.availability || state.config.roomPriority.map(room => ({ name: room.name, available: true, status: "available" })) };
    else if (path === "/api/reservations") {
      const profiles = req.method() === "POST" ? req.postDataJSON().profiles : state.book;
      state.lookupRequests ||= []; state.lookupRequests.push({ method: req.method(), profiles });
      result = state.lookupResult || { reservations: [], lookupErrors: [], lookupStatuses: profiles.map((profile, profileIndex) => ({ profileIndex, profileLabel: profile.reserverName, profile: { reserverName: profile.reserverName, phone: profile.phone }, count: 0 })) };
    }
    else if (path === "/api/plans" && req.method() === "POST") {
      const id = `00000000-0000-0000-0000-${String(state.plans.length + 1).padStart(12, "0")}`;
      state.plans.push({ ...req.postDataJSON(), id, enabled: false, status: { state: "idle" } });
      result = { id };
    } else if (/^\/api\/plans\/[a-f0-9-]{36}$/.test(path) && req.method() === "PUT") {
      const id = path.split("/").pop();
      const entry = state.plans.find(plan => plan.id === id);
      Object.assign(entry, req.postDataJSON(), { id, enabled: false, status: { state: "stopped", stage: "stopped", message: "일정 수정을 저장했습니다." } });
      result = { id };
    } else if (/^\/api\/plans\/[a-f0-9-]{36}$/.test(path) && req.method() === "DELETE") {
      const id = path.split("/").pop(), entry = state.plans.find(plan => plan.id === id);
      if (entry?.enabled) return route.fulfill({ status: 409, json: { error: "진행 중 삭제 불가" } });
      state.plans = state.plans.filter(plan => plan.id !== id); result = { ok: true };
    } else if (path === "/api/plans") result = { entries: state.plans };
    else if (/^\/api\/plans\/[a-f0-9-]{36}\/(start|stop)$/.test(path)) {
      const [, , , id, action] = path.split("/");
      const entry = state.plans.find(plan => plan.id === id);
      state.planCalls.push({ id, action, body: req.postData() ? req.postDataJSON() : {} });
      if (action === "start" && state.rejectStartPlan === id) return route.fulfill({ status: 409, json: { error: "시작 실패 테스트" } });
      entry.enabled = action === "start";
      entry.status = { state: action === "start" ? "waiting" : "stopped", stage: action === "start" ? "armed" : "stopped" };
      result = { ok: true, status: entry.status };
    }
    else if (path === "/api/logs") { state.logsRead++; result = { entries: [] }; }
    else result = { entries: [], rooms: [], state: "idle", stage: "idle", synced: true, serverNowMs: Date.parse("2026-10-12T10:00:00+09:00"), lastSyncedAt: Date.now(), offsetMs: 0, rttMs: 1 };
    return route.fulfill({ json: result });
  });
  await page.goto("https://app.test/");
  await page.waitForFunction(expected => document.querySelector("#bookingProfileSelect1").options.length === expected, count + 1);
  await page.waitForFunction(() => availabilityContext === `${elements.startDate.value}/${Number(elements.nights.value)}`);
  return state;
}

export async function openPlanDetails(page, index = 0) {
  if (await page.locator("#planDetailsDialog").isVisible()) await page.locator("#planDetailsClose").click();
  await page.locator("#executionPlanList .plan-detail-open").nth(index).click();
  await page.locator("#planList .plan-entry").waitFor();
}
