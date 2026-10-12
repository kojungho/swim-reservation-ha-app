import { readFile } from "node:fs/promises";
import { defaultConfig, normalizeConfig, normalizeProfile } from "../../src/config.js";

export const testGuest = (number = 1) => ({ reserverName: `저장예약자${number}`, depositorName: `입금자${number}`, phone: `0101234567${number}`, birthDate: "19900101" });
export async function mockBookApp(page, count = 2) {
  const state = { book: Array.from({ length: count }, (_, index) => testGuest(index + 1)), lookupBook: [], plans: [], writes: [], errors: [], rejectBook: false, logsRead: 0 };
  if (state.book.length) state.book[0].roomPriority = [{ name: "달_하늘존", enabled: true }];
  state.config = normalizeConfig({ ...defaultConfig(), startDate: "2026-12-20", triggerAt: "2026-10-20T00:00:00", profiles: state.book, roomPriority: [{ name: "해_하늘존", enabled: false }, { name: "달_하늘존", enabled: false }] });
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
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
    } else if (path === "/api/reservations") result = { reservations: [], lookupErrors: [] };
    else if (path === "/api/plans" && req.method() === "POST") {
      const id = `00000000-0000-0000-0000-${String(state.plans.length + 1).padStart(12, "0")}`;
      state.plans.push({ ...req.postDataJSON(), id, enabled: false, status: { state: "idle" } });
      result = { id };
    } else if (path === "/api/plans") result = { entries: state.plans };
    else if (path === "/api/logs") { state.logsRead++; result = { entries: [] }; }
    else result = { entries: [], rooms: [], state: "idle", stage: "idle", synced: true, serverNowMs: Date.parse("2026-10-12T10:00:00+09:00"), lastSyncedAt: Date.now(), offsetMs: 0, rttMs: 1 };
    return route.fulfill({ json: result });
  });
  await page.goto("https://app.test/");
  await page.waitForFunction(expected => document.querySelector("#bookingProfileSelect1").options.length === expected, count + 1);
  return state;
}
