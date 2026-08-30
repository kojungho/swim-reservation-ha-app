import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig, reservationUrl } from "../src/config.js";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
let config = defaultConfig(new Date("2026-08-30T12:00:00+09:00"));
let history = [];
const status = { state: "idle", stage: "idle", message: "UI 테스트 서버", updatedAt: Date.now() };

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
    return json(response, { entries: history.map((entry) => ({ id: entry.id, savedAt: entry.savedAt, startDate: entry.config.startDate, nights: entry.config.nights, bookingMode: entry.config.bookingMode, enabledRooms: entry.config.roomPriority.filter((room) => room.enabled).map((room) => room.name) })) });
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
  if (url.pathname === "/api/inspect") return json(response, { ok: true, rooms: config.roomPriority.map((room, index) => ({ name: room.name, available: index % 3 !== 2 })) });
  if (url.pathname === "/api/start" || url.pathname === "/api/stop" || url.pathname === "/api/run-now") return json(response, { ok: true });
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
