import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig, reservationUrl, triggerEpoch, validateConfig } from "./config.js";
import { ReservationEngine } from "./reservation-engine.js";
import { Scheduler } from "./scheduler.js";
import { Store } from "./store.js";
import { reservationCheckUrl } from "./reservation-check.js";
import { ReservationManager } from "./reservation-manager.js";
import { SiteTimeSync } from "./site-time.js";

const PORT = Number(process.env.PORT || 8099);
const DATA_DIR = process.env.DATA_DIR || "/data";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const store = new Store(DATA_DIR);
const engine = new ReservationEngine({ store, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
const timeSync = new SiteTimeSync();
const scheduler = new Scheduler({ store, engine, timeSync });
const reservationManager = new ReservationManager({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });

await store.init();
await store.recordLog("info", "startup", "쉼오지 예약 도우미를 시작했습니다.").catch(() => {});
await timeSync.sync().catch((error) => console.error(`서버 시간 초기 동기화 실패: ${error.message}`));
timeSync.start();
await scheduler.restore().catch(async (error) => {
  console.error(`예약 대기 복원 실패: ${error.message}`);
  await store.updateStatus({ state: "failed", stage: "exception", message: error.message });
});

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/config" && request.method === "GET") {
      const config = await store.getConfig();
      return json(response, 200, { ...config, reservationUrl: reservationUrl(config.startDate) });
    }
    if (url.pathname === "/api/config" && request.method === "PUT") {
      const config = normalizeConfig(await readJsonBody(request));
      const errors = validateConfig(config);
      if (errors.length) return json(response, 400, { ok: false, error: `확인할 항목: ${errors.join(", ")}` });
      const saved = await store.saveConfig(config);
      return json(response, 200, { ok: true, config: { ...saved, reservationUrl: reservationUrl(saved.startDate) } });
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
      const config = await store.getConfig();
      const requestedProfile = url.searchParams.get("profile") === "2" && config.useSecondProfile ? config.profile2 : config.profile1 || config.profile;
      return json(response, 200, { ok: true, url: reservationCheckUrl(requestedProfile) });
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
      if (scheduler.running || scheduler.armed) return json(response, 409, { ok: false, error: "예약 대기 또는 실행 중에는 예약 내역 조회를 사용할 수 없습니다." });
      const config = await store.getConfig();
      const profiles = [{ index: 0, label: "예약자 1", profile: config.profile1 || config.profile }];
      if (config.useSecondProfile) profiles.push({ index: 1, label: "예약자 2", profile: config.profile2 });
      const reservations = [];
      for (const entry of profiles) {
        const found = await reservationManager.list(entry.profile);
        reservations.push(...found.map((item) => ({ ...item, profileIndex: entry.index, profileLabel: entry.label })));
      }
      await store.recordLog("info", "reservation-check", `예약확인 결과 ${reservations.length}건을 찾았습니다.`);
      return json(response, 200, { ok: true, reservations });
    }
    const cancelMatch = /^\/api\/reservations\/(\d+)\/cancel$/.exec(url.pathname);
    if (cancelMatch && request.method === "POST") {
      if (scheduler.running || scheduler.armed) return json(response, 409, { ok: false, error: "예약 대기 또는 실행 중에는 예약 취소를 사용할 수 없습니다." });
      const input = await readJsonBody(request);
      if (input.confirmed !== true) return json(response, 400, { ok: false, error: "예약 취소 최종 확인이 필요합니다." });
      const config = await store.getConfig();
      const profileIndex = input.profileIndex === 1 && config.useSecondProfile ? 1 : 0;
      const profile = profileIndex === 1 ? config.profile2 : config.profile1 || config.profile;
      const result = await reservationManager.cancel(profile, cancelMatch[1]);
      return json(response, 200, {
        ok: true,
        canceled: { ...result.canceled, profileIndex, profileLabel: `예약자 ${profileIndex + 1}` },
        reservations: result.reservations.map((item) => ({ ...item, profileIndex, profileLabel: `예약자 ${profileIndex + 1}` }))
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
      const config = await store.getConfig();
      const siteNow = await timeSync.ensureSynced();
      const errors = validateConfig(config, { futureTrigger: true, nowMs: siteNow });
      if (errors.length) return json(response, 400, { ok: false, error: `확인할 항목: ${errors.join(", ")}` });
      await scheduler.arm(config);
      return json(response, 200, { ok: true, targetAt: triggerEpoch(config.triggerAt) });
    }
    if (url.pathname === "/api/run-now" && request.method === "POST") {
      const config = await store.getConfig();
      const errors = validateConfig(config);
      if (errors.length) return json(response, 400, { ok: false, error: `확인할 항목: ${errors.join(", ")}` });
      if (scheduler.running) return json(response, 409, { ok: false, error: "이미 예약 엔진이 실행 중입니다." });
      await scheduler.runNow(config);
      return json(response, 202, { ok: true, startedAt: timeSync.now() });
    }
    if (url.pathname === "/api/stop" && request.method === "POST") {
      await scheduler.stop();
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/inspect" && request.method === "POST") {
      if (scheduler.running || scheduler.preparing) return json(response, 409, { ok: false, error: "예약 실행 또는 사전 준비 중에는 객실 확인을 사용할 수 없습니다." });
      const input = await readJsonBody(request);
      const stored = await store.getConfig();
      const config = normalizeConfig({
        ...stored,
        startDate: input.startDate || stored.startDate,
        nights: Number(input.nights || stored.nights)
      });
      const rooms = await engine.inspect(config);
      const { addedRooms } = await store.mergeDiscoveredRooms(rooms.map((room) => room.name));
      if (!scheduler.armed) {
        await store.updateStatus({ state: "idle", stage: "inspected", message: "예약 페이지 연결과 객실 목록을 확인했습니다." });
      }
      return json(response, 200, { ok: true, rooms, addedRooms, reservationUrl: reservationUrl(config.startDate) });
    }
    if (url.pathname === "/health" && request.method === "GET") return json(response, 200, { ok: true });
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    await store.recordLog("error", "server-error", error.message || "서버 오류가 발생했습니다.").catch(() => {});
    return json(response, 500, { ok: false, error: error.message || "서버 오류가 발생했습니다." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`쉼오지 예약 도우미가 ${PORT} 포트에서 실행 중입니다.`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
    timeSync.stop();
    await engine.close();
    server.close(() => process.exit(0));
  });
}

async function serveStatic(pathname, response) {
  const routes = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
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
