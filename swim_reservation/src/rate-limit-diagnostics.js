import iconv from "iconv-lite";

// Store only recognized categories/numbers, never arbitrary headers or page text.
export function rateLimitHeaders(headers = {}) {
  const get = name => String(headers[name] || "").slice(0, 512);
  const server = get("server").toLowerCase();
  const serverFamily = ["cloudflare", "nginx", "apache", "envoy", "litespeed", "haproxy", "microsoft-iis"].find(name => server.includes(name)) || "unknown";
  const rawRetry = get("retry-after");
  const retryAfter = /^\d{1,8}$/.test(rawRetry) ? rawRetry : /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(rawRetry) && Number.isFinite(Date.parse(rawRetry)) ? rawRetry : null;
  const rateLimits = {};
  for (const name of ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
    if (/^\d{1,12}$/.test(get(name))) rateLimits[name] = Number(get(name));
  }
  const contentType = /^(text\/html|text\/plain|application\/json)\b/i.exec(get("content-type"))?.[1].toLowerCase() || "other";
  return { retryAfter, serverFamily, contentType, viaPresent: Boolean(get("via")), edgeMarkerPresent: Boolean(get("cf-ray") || get("x-sucuri-id") || get("x-akamai-transformed")), rateLimits };
}

export function rateLimitNotice(body) {
  const text = String(body).slice(0, 32768).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ");
  const notices = [];
  if (/too many requests|rate[ -]?limit|요청.{0,16}(?:초과|제한)|접속.{0,16}(?:초과|제한)/i.test(text)) notices.push("요청 횟수 제한 안내");
  if (/access denied|접근.{0,8}(?:차단|거부)|접속.{0,8}차단/i.test(text)) notices.push("접근 차단 안내");
  if (/captcha|verify.{0,20}human|보안.{0,8}(?:검사|확인)|자동화.{0,12}(?:탐지|차단)/i.test(text)) notices.push("보안 확인 안내");
  const edgeBrand = ["cloudflare", "akamai", "sucuri", "imperva"].find(name => text.toLowerCase().includes(name)) || null;
  return { notices, edgeBrand };
}

export async function collectRateLimitDiagnostics(response, { timeoutMs = 1200 } = {}) {
  const headers = response.headers(), diagnostic = { ...rateLimitHeaders(headers), notices: [], edgeBrand: null, bodyInspection: "skipped-unknown-size", sourceHint: "undetermined" };
  const size = /^\d{1,8}$/.test(headers["content-length"] || "") ? Number(headers["content-length"]) : null;
  if (headers["content-encoding"]) diagnostic.bodyInspection = "skipped-encoded-body";
  else if (size !== null && size <= 32768 && diagnostic.contentType !== "other") {
    let timer;
    try {
      const body = await Promise.race([response.body(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); })]);
      if (body.length > 32768) diagnostic.bodyInspection = "skipped-too-large";
      else Object.assign(diagnostic, rateLimitNotice(iconv.decode(body, /charset\s*=\s*["']?(?:euc-kr|ks_c_5601-1987|cp949)/i.test(headers["content-type"] || "") ? "euc-kr" : "utf8")), { bodyInspection: "classified-no-raw-text" });
    } catch { diagnostic.bodyInspection = "unavailable"; }
    finally { clearTimeout(timer); }
  } else if (size !== null && size > 32768) diagnostic.bodyInspection = "skipped-too-large";
  if (diagnostic.edgeMarkerPresent || diagnostic.edgeBrand || diagnostic.serverFamily === "cloudflare") diagnostic.sourceHint = "edge-or-security-clue-not-confirmed";
  return diagnostic;
}
