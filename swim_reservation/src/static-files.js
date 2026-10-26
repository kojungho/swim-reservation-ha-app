import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
const PUBLIC_DIR=fileURLToPath(new URL("../public/",import.meta.url));
export async function serveStatic(pathname, response) {
  const routes = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/booking-flow.js": ["booking-flow.js", "text/javascript; charset=utf-8"],
    "/booking-flow.css": ["booking-flow.css", "text/css; charset=utf-8"],
    "/toast.js": ["toast.js", "text/javascript; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/workspace.js": ["workspace.js", "text/javascript; charset=utf-8"],
    "/editor-drafts.js": ["editor-drafts.js", "text/javascript; charset=utf-8"],
    "/stay-calendar.js": ["stay-calendar.js", "text/javascript; charset=utf-8"],
    "/site-choice.js": ["site-choice.js", "text/javascript; charset=utf-8"],
    "/booking-book.js": ["booking-book.js", "text/javascript; charset=utf-8"],
    "/ui-settings.js": ["ui-settings.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/site-map.png": ["site-map.png", "image/png"]
  };
  const route = routes[pathname];
  if (!route) { response.writeHead(404,{"Content-Type":"application/json; charset=utf-8"});response.end(JSON.stringify({error:"Not found"}));return; }
  const body = await readFile(path.join(PUBLIC_DIR, route[0]));
  response.writeHead(200, { "Content-Type": route[1], "Cache-Control": "no-store" });
  response.end(body);
}
