import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig, reservationUrl, triggerEpoch, validateConfig } from "./config.js";
import { ReservationEngine } from "./reservation-engine.js";
import { Scheduler } from "./scheduler.js";
import { Store } from "./store.js";
import { reservationCheckUrl } from "./reservation-check.js";

const PORT = Number(process.env.PORT || 8099);
const DATA_DIR = process.env.DATA_DIR || "/data";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const store = new Store(DATA_DIR);
const engine = new ReservationEngine({ store, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium" });
const scheduler = new Scheduler({ store, engine });

await store.init();
await scheduler.restore();

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
    if (url.pathname === "/reservation-check" && request.method === "GET") {
      const config = await store.getConfig();
      response.writeHead(302, {
        Location: reservationCheckUrl(config.profile),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer"
      });
      return response.end();
    }
    if (url.pathname === "/api/history" && request.method === "GET") {
      return json(response, 200, { entries: await store.listHistory() });
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
      const errors = validateConfig(config, { futureTrigger: true });
      if (errors.length) return json(response, 400, { ok: false, error: `확인할 항목: ${errors.join(", ")}` });
      await scheduler.arm(config);
      return json(response, 200, { ok: true, targetAt: triggerEpoch(config.triggerAt) });
    }
    if (url.pathname === "/api/run-now" && request.method === "POST") {
      const config = await store.getConfig();
      const errors = validateConfig(config);
      if (errors.length) return json(response, 400, { ok: false, error: `확인할 항목: ${errors.join(", ")}` });
      if (triggerEpoch(config.triggerAt) > Date.now()) {
        return json(response, 409, { ok: false, error: `아직 예약 오픈 전입니다. ${config.triggerAt} 이후 예약하거나 예약 대기를 시작하세요.` });
      }
      if (scheduler.running) return json(response, 409, { ok: false, error: "이미 예약 엔진이 실행 중입니다." });
      await scheduler.runNow(config);
      return json(response, 202, { ok: true, startedAt: Date.now() });
    }
    if (url.pathname === "/api/stop" && request.method === "POST") {
      await scheduler.stop();
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/inspect" && request.method === "POST") {
      if (scheduler.running || scheduler.armed) return json(response, 409, { ok: false, error: "예약 대기 또는 실행 중에는 객실 확인을 사용할 수 없습니다." });
      const input = await readJsonBody(request);
      const stored = await store.getConfig();
      const config = normalizeConfig({
        ...stored,
        startDate: input.startDate || stored.startDate,
        nights: Number(input.nights || stored.nights)
      });
      const rooms = await engine.inspect(config);
      await store.updateStatus({ state: "idle", stage: "inspected", message: "예약 페이지 연결과 객실 목록을 확인했습니다." });
      return json(response, 200, { ok: true, rooms, reservationUrl: reservationUrl(config.startDate) });
    }
    if (url.pathname === "/health" && request.method === "GET") return json(response, 200, { ok: true });
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    return json(response, 500, { ok: false, error: error.message || "서버 오류가 발생했습니다." });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`쉼오지 예약 도우미가 ${PORT} 포트에서 실행 중입니다.`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, async () => {
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
