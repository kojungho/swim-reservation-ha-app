import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig, reservationUrl } from "../src/config.js";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
let config = defaultConfig(new Date("2026-08-30T12:00:00+09:00"));
let history = [];
const status = {
  state: process.env.MOCK_STATUS_STATE || "idle",
  stage: process.env.MOCK_STATUS_STATE === "success" ? "complete" : process.env.MOCK_STATUS_STATE === "failed" ? "profile-uncertain" : "idle",
  message: "UI 테스트 서버",
  updatedAt: Date.now()
};
const logs = [{ timestamp: Date.now(), level: "info", event: "startup", message: "UI 테스트 로그", details: {} }];

http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:8877");
  if (url.pathname === "/api/config" && request.method === "GET") return json(response, { ...config, reservationUrl: reservationUrl(config.startDate) });
  if (url.pathname === "/api/config" && request.method === "PUT") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    config = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const id = `${config.startDate}__${config.nights}`;
    history = [{ id, savedAt: Date.now(), config }, ...history.filter((entry) => entry.id !== id)];
    return json(response, { ok: true, config: { ...config, reservationUrl: reservationUrl(config.startDate) } });
  }
  if (url.pathname === "/api/history" && request.method === "GET") {
    return json(response, { entries: history.map((entry) => ({ id: entry.id, savedAt: entry.savedAt, startDate: entry.config.startDate, nights: entry.config.nights, bookingMode: entry.config.bookingMode, useSecondProfile: Boolean(entry.config.useSecondProfile), enabledRooms: entry.config.roomPriority.filter((room) => room.enabled).map((room) => room.name) })) });
  }
  const historyMatch = /^\/api\/history\/([^/]+)(?:\/(load))?$/.exec(url.pathname);
  if (historyMatch && request.method === "POST" && historyMatch[2] === "load") {
    const entry = history.find((item) => item.id === decodeURIComponent(historyMatch[1]));
    if (!entry) return json(response, { error: "Not found" });
    config = entry.config;
    return json(response, { ok: true, config: { ...config, reservationUrl: reservationUrl(config.startDate) } });
  }
  if (historyMatch && request.method === "DELETE") {
    history = history.filter((item) => item.id !== decodeURIComponent(historyMatch[1]));
    return json(response, { ok: true });
  }
  if (url.pathname === "/api/status") return json(response, status);
  if (url.pathname === "/api/logs") return json(response, { ok: true, entries: logs });
  if (url.pathname === "/api/logs/download") {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "attachment; filename=swim-reservation-log.txt" });
    return response.end("UI 테스트 로그\n");
  }
  if (url.pathname === "/api/site-time" || url.pathname === "/api/site-time/sync") return json(response, {
    synced: true, serverNowMs: Date.parse("2026-08-31T09:59:58+09:00"), lastSyncedAt: Date.now(), offsetMs: 327, rttMs: 42, precisionMs: 1000, stale: false
  });
  if (url.pathname === "/api/reservation-check-url") return json(response, { ok: true, url: "http://newpension.logosweb.or.kr/reservation/order_ok7.php?id=swim" });
  if (url.pathname === "/api/reservations" && request.method === "GET") {
    logs.push({ timestamp: Date.now(), level: "info", event: "reservation-check", message: "자동 예약확인 실행", details: {} });
    return json(response, {
    ok: true,
    reservations: [{ id: "493304", room: "숨_산맥존", stayDate: "2026년10월07일", nights: "1박", total: "60,000원", status: "예약대기 중", cancelable: true }]
    });
  }
  if (/^\/api\/reservations\/\d+\/cancel$/.test(url.pathname) && request.method === "POST") return json(response, { ok: true, reservations: [] });
  if (url.pathname === "/api/inspect") {
    const newRoom = process.env.MOCK_NEW_ROOM || "";
    const rooms = process.env.MOCK_EMPTY_ROOMS === "1" ? [] : config.roomPriority.map((room, index) => ({ name: room.name, available: index % 3 !== 2 }));
    if (newRoom && !rooms.some((room) => room.name === newRoom)) rooms.push({ name: newRoom, available: true });
    return json(response, { ok: true, rooms, addedRooms: newRoom ? [newRoom] : [] });
  }
  if (url.pathname === "/api/start") { status.state = "waiting"; status.stage = "armed"; return json(response, { ok: true }); }
  if (url.pathname === "/api/stop") { status.state = "stopped"; status.stage = "stopped"; return json(response, { ok: true }); }
  if (url.pathname === "/api/run-now") { status.state = "running"; status.stage = "starting-now"; return json(response, { ok: true }); }
  const files = { "/": ["index.html", "text/html"], "/styles.css": ["styles.css", "text/css"], "/app.js": ["app.js", "text/javascript"], "/site-map.png": ["site-map.png", "image/png"] };
  const file = files[url.pathname];
  if (!file) { response.writeHead(404); return response.end(); }
  response.writeHead(200, { "Content-Type": file[1] });
  response.end(await readFile(path.join(publicDir, file[0])));
}).listen(8877, "127.0.0.1", () => console.log("mock UI server: http://127.0.0.1:8877"));

function json(response, value) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}
