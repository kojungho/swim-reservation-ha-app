import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultConfig, reservationUrl } from "../src/config.js";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
let config = defaultConfig(new Date("2026-08-30T12:00:00+09:00"));
const status = { state: "idle", stage: "idle", message: "UI 테스트 서버", updatedAt: Date.now() };

http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:8877");
  if (url.pathname === "/api/config" && request.method === "GET") return json(response, { ...config, reservationUrl: reservationUrl(config.startDate) });
  if (url.pathname === "/api/config" && request.method === "PUT") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    config = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return json(response, { ok: true, config: { ...config, reservationUrl: reservationUrl(config.startDate) } });
  }
  if (url.pathname === "/api/status") return json(response, status);
  if (url.pathname === "/api/inspect") return json(response, { ok: true, rooms: config.roomPriority.map((room, index) => ({ name: room.name, available: index % 3 !== 2 })) });
  if (url.pathname === "/api/start" || url.pathname === "/api/stop" || url.pathname === "/api/run-now") return json(response, { ok: true });
  const files = { "/": ["index.html", "text/html"], "/styles.css": ["styles.css", "text/css"], "/app.js": ["app.js", "text/javascript"] };
  const file = files[url.pathname];
  if (!file) { response.writeHead(404); return response.end(); }
  response.writeHead(200, { "Content-Type": file[1] });
  response.end(await readFile(path.join(publicDir, file[0])));
}).listen(8877, "127.0.0.1", () => console.log("mock UI server: http://127.0.0.1:8877"));

function json(response, value) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}
