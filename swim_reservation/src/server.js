import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig, normalizeProfile, validateProfile, reservationUrl, triggerEpoch, validateConfig, getProfiles } from "./config.js";
import { ReservationEngine } from "./reservation-engine.js";
import { Scheduler } from "./scheduler.js";
import { Store } from "./store.js";
import { reservationCheckUrl } from "./reservation-check.js";
import { ReservationManager } from "./reservation-manager.js";
import { SiteTimeSync } from "./site-time.js";
import { InspectionService } from "./inspection-service.js";
import { SiteMap } from "./site-map.js";
import { lookupProfiles } from "./profile-lookup.js";
import { inspectMonth, monthlyUrl, inspectCalendarDay, calendarDayUrl } from "./monthly-availability.js";
import { PlanManager, singleBookingConfig } from "./plan-manager.js";
import { MonthCache } from "./month-cache.js";

const PORT = Number(process.env.PORT || 8099);
const DATA_DIR = process.env.DATA_DIR || "/data";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const store = new Store(DATA_DIR);
const siteMap = new SiteMap(DATA_DIR, path.join(PUBLIC_DIR, "site-map.png"));
const engine = new ReservationEngine({ store, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
const timeSync = new SiteTimeSync();
const scheduler = new Scheduler({ store, engine, timeSync });
const inspections = new InspectionService(
  () => {
    const reader = new ReservationEngine({ store, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
    const inspectRooms = reader.inspect.bind(reader);
    reader.inspect = config => config.month ? inspectMonth(reader, config) : config.calendarDate ? inspectCalendarDay(reader, config) : inspectRooms(config);
    return reader;
  },
  () => !scheduler.running && !scheduler.preparing && !plans.busy
);
const plans = new PlanManager({ dataDir: DATA_DIR, timeSync,
  engineFactory: planStore => new ReservationEngine({ store: planStore, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" }),
  inspect: (config, signal) => inspections.inspect(config, signal),
  canInspect: () => !scheduler.running && !scheduler.preparing,
  log: (...args) => store.recordLog(...args)
});
const reservationManager = new ReservationManager({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
const monthCache = new MonthCache({ dataDir: DATA_DIR, now: () => timeSync.now(),
  inspect: (config, signal) => inspections.inspect(config, signal),
  knownRooms: async () => (await store.getConfig()).roomPriority.map(room => room.name),
  canInspect: () => !scheduler.running && !scheduler.preparing && !plans.busy &&
    ![scheduler, ...[...plans.plans.values()].filter(plan => plan.enabled).map(plan => plan.scheduler)]
      .some(item => item.armed && triggerEpoch(item.armedConfig?.triggerAt) - timeSync.now() < 300_000)
});

await store.init();
await store.getLookupProfiles();
await store.recordLog("info", "startup", "쉼오지 예약 도우미를 시작했습니다.").catch(() => {});
await timeSync.sync().catch((error) => console.error(`서버 시간 초기 동기화 실패: ${error.message}`));
timeSync.start();
const legacyStatus = await store.getStatus();
const legacyConfig = legacyStatus.armedConfig || await store.getConfig();
if (legacyStatus.state === "waiting" && legacyConfig.bookingMode === "priority" && getProfiles(legacyConfig).length > 1) {
  await store.updateStatus({ state: "stopped", stage: "stopped", message: "기존 다인 순차 대기를 중지했습니다. 예약자 한 명 또는 예약자별 동시 모드를 확인하고 새 일정으로 시작하세요." });
} else await scheduler.restore().catch(async (error) => {
  console.error(`예약 대기 복원 실패: ${error.message}`);
  await store.updateStatus({ state: "failed", stage: "exception", message: error.message });
});
await plans.init();
await monthCache.init();
monthCache.start();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/month-cache" && request.method === "GET") return json(response, 200, monthCache.status());
    if (url.pathname === "/api/month-cache" && request.method === "PUT") {
      try { return json(response, 200, await monthCache.configure((await readJsonBody(request)).intervalMinutes)); }
      catch (error) { return json(response, 400, { error: error.message }); }
    }
    if (url.pathname === "/api/month-cache/refresh" && request.method === "POST") return json(response, 202, monthCache.refresh());
    if (url.pathname === "/api/plans" && request.method === "GET") return json(response, 200, { entries: await plans.list() });
    if (url.pathname === "/api/plans/stop-all" && request.method === "POST") {
      for (const plan of plans.plans.values()) if (plan.enabled) await plans.stop(plan.id);
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/plans" && request.method === "POST") {
      try { return json(response, 201, { id: await plans.add(await readJsonBody(request)) }); }
      catch (error) { return json(response, 400, { error: error.message }); }
    }
    const planMatch = /^\/api\/plans\/([a-f0-9-]{36})(?:\/(start|stop))?$/.exec(url.pathname);
    if (planMatch) {
      try {
        if (request.method === "PUT" && !planMatch[2]) return json(response, 200, { id: await plans.update(planMatch[1], await readJsonBody(request)) });
        if (request.method === "POST" && planMatch[2] === "start") { await monthCache.pause(); await plans.start(planMatch[1]); return json(response, 200, { ok: true, status: await plans.get(planMatch[1]).store.getStatus() }); }
        if (request.method === "POST" && planMatch[2] === "stop") { await plans.stop(planMatch[1]); return json(response, 200, { ok: true }); }
        if (request.method === "DELETE" && !planMatch[2]) { await plans.remove(planMatch[1]); return json(response, 200, { ok: true }); }
      } catch (error) { return json(response, 409, { error: error.message }); }
    }
    if (url.pathname === "/api/site-map" && request.method === "GET") {
      const body = await siteMap.read();
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return response.end(body);
    }
    if (url.pathname === "/api/site-map" && request.method === "PUT") {
      try {
        await siteMap.save(request);
        return json(response, 200, { ok: true });
      } catch (error) {
        if (error.statusCode) return json(response, error.statusCode, { ok: false, error: error.message });
        throw error;
      }
    }
    if (url.pathname === "/api/config" && request.method === "GET") {
      const config = await store.getConfig();
      return json(response, 200, { ...config, reservationUrl: reservationUrl(config.startDate) });
    }
    if (url.pathname === "/api/profiles" && request.method === "GET") {
      return json(response, 200, { profiles: await store.getSavedProfiles() });
    }
    if (url.pathname === "/api/lookup-profiles" && request.method === "GET") return json(response, 200, { profiles: await store.getLookupProfiles() });
    if (url.pathname === "/api/lookup-profiles" && request.method === "PUT") {
      try { const input = await readJsonBody(request); return json(response, 200, { profiles: await store.saveLookupProfiles(input.profiles) }); }
      catch (error) { return json(response, 400, { error: error.message }); }
    }
    if (url.pathname === "/api/profiles" && request.method === "PUT") {
      if (scheduler.running || scheduler.preparing) return json(response, 409, { error: "예약 실행 또는 준비 중에는 예약자 저장을 변경할 수 없습니다." });
      const input = await readJsonBody(request);
      if (!Array.isArray(input.profiles) || input.profiles.length > 5) return json(response, 400, { error: "예약자는 최대 5명까지 저장할 수 있습니다." });
      const profiles = input.profiles.map(normalizeProfile);
      const errors = [];
      profiles.forEach((profile, index) => validateProfile(profile, `예약자 ${index + 1}`, errors));
      if (errors.length) return json(response, 400, { error: `확인할 항목: ${errors.join(", ")}` });
      if (input.selectedIndex !== undefined && (!Number.isInteger(input.selectedIndex) || input.selectedIndex < 0 || input.selectedIndex >= profiles.length)) return json(response, 400, { error: "선택한 예약자를 확인하세요." });
      const savedProfiles = await store.saveProfiles(profiles);
      if (input.selectedIndex !== undefined) await store.saveConfig({ ...await store.getConfig(), editorProfileIndex: input.selectedIndex }, { recordHistory: false });
      return json(response, 200, { ok: true, profiles: savedProfiles });
    }
    if (url.pathname === "/api/config" && request.method === "PUT") {
      const input = normalizeConfig(await readJsonBody(request));
      const config = singleBookingConfig(input);
      const errors = validateConfig(config);
      if (errors.length) return json(response, 400, { ok: false, error: `확인할 항목: ${errors.join(", ")}` });
      const saved = await store.saveConfig(config);
      return json(response, 200, { ok: true, config: { ...saved, editorProfiles: getProfiles(input), editorProfileIndex: input.multipleProfileIndex || 0, reservationUrl: reservationUrl(saved.startDate) } });
    }
    if (url.pathname === "/api/status" && request.method === "GET") {
      return json(response, 200, await store.getStatus());
    }
    if (url.pathname === "/api/logs" && request.method === "GET") {
      return json(response, 200, { ok: true, entries: await store.listLogs(url.searchParams.get("limit")) });
    }
    if (url.pathname === "/api/logs/download" && request.method === "GET") {
      const entries = await store.listLogs(1000);
      const body = entries.slice().reverse().map(formatLogEntry).join("\n");
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
      response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="swim-reservation-log-${day}.txt"`,
        "Cache-Control": "no-store"
      });
      return response.end(`${body}${body ? "\n" : ""}`);
    }
    if (url.pathname === "/api/reservation-check-url" && request.method === "GET") {
      const requestedProfile = (await store.getLookupProfiles())[Number(url.searchParams.get("profile") || 1) - 1];
      if (!requestedProfile) return json(response, 400, { error: "예약자를 확인해 주세요." });
      return json(response, 200, { ok: true, url: reservationCheckUrl(requestedProfile) });
    }
    if (url.pathname === "/api/reservation-check-url" && request.method === "POST") {
      const input = await readJsonBody(request);
      return json(response, 200, { ok: true, url: reservationCheckUrl(normalizeProfile(input.profile)) });
    }
    if (url.pathname === "/api/site-time" && request.method === "GET") {
      return json(response, 200, timeSync.status());
    }
    if (url.pathname === "/api/site-time/sync" && request.method === "POST") {
      try {
        return json(response, 200, await timeSync.sync());
      } catch (error) {
        return json(response, 503, { synced: false, error: error.message });
      }
    }
    if (url.pathname === "/api/history" && request.method === "GET") {
      return json(response, 200, { entries: await store.listHistory() });
    }
    if (url.pathname === "/api/reservations" && request.method === "GET") {
      if (scheduler.running || scheduler.preparing) return json(response, 409, { ok: false, error: "예약 실행 또는 준비 중에는 예약 내역 조회를 잠시 기다려 주세요." });
      const result = await lookupProfiles(await store.getLookupProfiles(), reservationManager, "조회 대상");
      const { reservations, lookupErrors } = result;
      await store.recordLog(lookupErrors.length ? "error" : "info", "reservation-check", `예약확인 ${reservations.length}건, 조회 실패 ${lookupErrors.length}명.`, { lookupErrors });
      return json(response, 200, result);
    }
    const cancelMatch = /^\/api\/reservations\/(\d+)\/cancel$/.exec(url.pathname);
    if (cancelMatch && request.method === "POST") {
      if (scheduler.running || scheduler.armed) return json(response, 409, { ok: false, error: "예약 대기 또는 실행 중에는 예약 취소를 사용할 수 없습니다." });
      const input = await readJsonBody(request);
      if (input.confirmed !== true) return json(response, 400, { ok: false, error: "예약 취소 최종 확인이 필요합니다." });
      const profileIndex = input.profileIndex ?? 0;
      const profile = Number.isInteger(profileIndex) && (await store.getLookupProfiles())[profileIndex];
      if (!profile) return json(response, 400, { error: "예약자를 확인해 주세요." });
      const result = await reservationManager.cancel(profile, cancelMatch[1]);
      return json(response, 200, {
        ok: true,
        canceled: { ...result.canceled, profileIndex, profileLabel: `조회 대상 ${profileIndex + 1}` },
        reservations: result.reservations.map((item) => ({ ...item, profileIndex, profileLabel: `조회 대상 ${profileIndex + 1}` }))
      });
    }
    const historyMatch = /^\/api\/history\/([^/]+)(?:\/(load))?$/.exec(url.pathname);
    if (historyMatch && request.method === "POST" && historyMatch[2] === "load") {
      const entry = await store.loadHistory(decodeURIComponent(historyMatch[1]));
      if (!entry) return json(response, 404, { ok: false, error: "저장 이력을 찾지 못했습니다." });
      return json(response, 200, { ok: true, config: { ...entry.config, reservationUrl: reservationUrl(entry.config.startDate) } });
    }
    if (historyMatch && request.method === "DELETE" && !historyMatch[2]) {
      const deleted = await store.deleteHistory(decodeURIComponent(historyMatch[1]));
      if (!deleted) return json(response, 404, { ok: false, error: "삭제할 저장 이력을 찾지 못했습니다." });
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/start" && request.method === "POST") {
      const config = singleBookingConfig(await store.getConfig());
      const siteNow = await timeSync.ensureSynced();
      const errors = validateConfig(config, { futureTrigger: true, nowMs: siteNow });
      if (errors.length) return json(response, 400, { ok: false, error: `확인할 항목: ${errors.join(", ")}` });
      await scheduler.arm(config);
      return json(response, 200, { ok: true, targetAt: triggerEpoch(config.triggerAt) });
    }
    if (url.pathname === "/api/run-now" && request.method === "POST") {
      const config = singleBookingConfig(await store.getConfig());
      const errors = validateConfig(config);
      if (errors.length) return json(response, 400, { ok: false, error: `확인할 항목: ${errors.join(", ")}` });
      if (scheduler.running) return json(response, 409, { ok: false, error: "이미 예약 엔진이 실행 중입니다." });
      await monthCache.pause();
      await scheduler.runNow(config);
      return json(response, 202, { ok: true, startedAt: timeSync.now() });
    }
    if (url.pathname === "/api/stop" && request.method === "POST") {
      await Promise.all([scheduler.stop(), inspections.cancelAll()]);
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/calendar-day" && request.method === "GET") {
      if (scheduler.running || scheduler.preparing) return json(response, 409, { code: "INSPECTION_BUSY", error: "예약 사전 준비 또는 실행 중에는 날짜별 조회를 잠시 기다려 주세요." });
      const calendarDate = url.searchParams.get("date") || "";
      try { calendarDayUrl(calendarDate); } catch (error) { return json(response, 400, { error: error.message }); }
      const controller = new AbortController();
      const cancel = () => { if (!response.writableEnded) controller.abort(); };
      response.once("close", cancel);
      if (response.destroyed) controller.abort();
      try {
        return json(response, 200, await inspections.inspect({ calendarDate }, controller.signal));
      } finally { response.off("close", cancel); }
    }
    if (url.pathname === "/api/monthly-availability" && request.method === "GET") {
      if (scheduler.running || scheduler.preparing) return json(response, 409, { code: "INSPECTION_BUSY", error: "예약 사전 준비 또는 실행 중에는 월별 조회를 잠시 기다려 주세요." });
      const month = url.searchParams.get("month") || "";
      try { monthlyUrl(month); } catch (error) { return json(response, 400, { error: error.message }); }
      const config = await store.getConfig();
      const controller = new AbortController();
      const cancel = () => { if (!response.writableEnded) controller.abort(); };
      response.once("close", cancel);
      if (response.destroyed) controller.abort();
      try {
        const result = await inspections.inspect({ month, nowMs: timeSync.now(), knownRooms: config.roomPriority.map(room => room.name) }, controller.signal);
        return json(response, 200, result);
      } finally { response.off("close", cancel); }
    }
    if (url.pathname === "/api/inspect" && request.method === "POST") {
      if (scheduler.running || scheduler.preparing) return json(response, 409, { ok: false, code: "INSPECTION_BUSY", error: "예약 실행 또는 사전 준비 중에는 객실 확인을 사용할 수 없습니다." });
      const input = await readJsonBody(request);
      const stored = await store.getConfig();
      const config = normalizeConfig({
        ...stored,
        startDate: input.startDate || stored.startDate,
        nights: Number(input.nights || stored.nights)
      });
      const controller = new AbortController();
      const cancel = () => { if (!response.writableEnded) controller.abort(); };
      response.once("close", cancel);
      if (response.destroyed) controller.abort();
      let rooms;
      try {
        rooms = await inspections.inspect(config, controller.signal);
      } finally {
        response.off("close", cancel);
      }
      const { addedRooms } = await store.mergeDiscoveredRooms(rooms.map((room) => room.name));
      if (!scheduler.armed && !scheduler.running && !scheduler.preparing) {
        await store.updateStatus({ state: "idle", stage: "inspected", message: "예약 페이지 연결과 객실 목록을 확인했습니다." });
      }
      return json(response, 200, { ok: true, rooms, addedRooms, reservationUrl: reservationUrl(config.startDate) });
    }
    if (url.pathname === "/health" && request.method === "GET") return json(response, 200, { ok: true });
    return serveStatic(url.pathname, response);
  } catch (error) {
    if (error.code === "INSPECTION_CANCELED" || error.code === "INSPECTION_BUSY") {
      if (response.destroyed) return;
      return json(response, 409, { ok: false, error: error.message, code: error.code });
    }
    console.error(error);
    await store.recordLog("error", "server-error", error.message || "서버 오류가 발생했습니다.").catch(() => {});
    return json(response, 500, { ok: false, error: error.message || "서버 오류가 발생했습니다." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`쉼오지 예약 도우미가 ${server.address().port} 포트에서 실행 중입니다.`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    timeSync.stop();
    scheduler.stopTimer();
    scheduler.armed = false;
    scheduler.cancelRequested = true;
    scheduler.operation++;
    await plans.close();
    await monthCache.close();
    await inspections.cancelAll();
    await engine.close();
    server.close(() => process.exit(0));
  });
}

async function serveStatic(pathname, response) {
  const routes = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/workspace.js": ["workspace.js", "text/javascript; charset=utf-8"],
    "/booking-book.js": ["booking-book.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/site-map.png": ["site-map.png", "image/png"]
  };
  const route = routes[pathname];
  if (!route) return json(response, 404, { error: "Not found" });
  const body = await readFile(path.join(PUBLIC_DIR, route[0]));
  response.writeHead(200, { "Content-Type": route[1], "Cache-Control": "no-store" });
  response.end(body);
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("요청 데이터가 너무 큽니다.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function formatLogEntry(entry) {
  const timestamp = new Date(entry.timestamp).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
  const details = entry.details && Object.keys(entry.details).length ? ` | ${JSON.stringify(entry.details)}` : "";
  return `[${timestamp}] [${entry.level === "error" ? "오류" : "정보"}] ${entry.message || entry.event || ""}${details}`;
}
