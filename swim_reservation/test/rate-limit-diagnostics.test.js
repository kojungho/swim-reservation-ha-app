import test from "node:test";
import assert from "node:assert/strict";
import { rateLimitHeaders, rateLimitNotice, collectRateLimitDiagnostics } from "../src/rate-limit-diagnostics.js";
import iconv from "iconv-lite";

test("예약 사이트의 EUC-KR 안내도 원문 저장 없이 유형만 판별한다", async () => {
  const body = iconv.encode("요청 횟수 초과. 고유이름 01012345678", "euc-kr");
  const value = await collectRateLimitDiagnostics({ headers: () => ({ "content-type": "text/html; charset=euc-kr", "content-length": String(body.length) }), body: async () => body });
  assert.deepEqual(value.notices, ["요청 횟수 제한 안내"]);
  assert.ok(!/고유이름|01012345678/.test(JSON.stringify(value)));
});

test("429 진단은 허용된 종류·숫자만 남기고 헤더·본문의 개인정보 원문은 저장하지 않는다", async () => {
  const headers = { server: "nginx secret@example.test", "retry-after": "60", "x-ratelimit-remaining": "0", "set-cookie": "session=secret", "cf-ray": "private-trace", via: "private.proxy", "content-type": "text/html", "content-length": "1000" };
  const body = Buffer.from("<h1>Too Many Requests</h1><p>Cloudflare access denied. 전화 01012345678 / 이름 비공개 / secret@example.test / token=secret</p>");
  const value = await collectRateLimitDiagnostics({ headers: () => headers, body: async () => body });
  assert.equal(value.retryAfter, "60"); assert.equal(value.serverFamily, "nginx"); assert.equal(value.rateLimits["x-ratelimit-remaining"], 0);
  assert.deepEqual(value.notices, ["요청 횟수 제한 안내", "접근 차단 안내"]);
  assert.equal(value.sourceHint, "edge-or-security-clue-not-confirmed");
  assert.equal(value.edgeBrand, "cloudflare");
  assert.ok(!/secret|private|01012345678|비공개|example\.test/.test(JSON.stringify(value)));
  assert.equal(rateLimitHeaders({ "retry-after": "01012345678 secret" }).retryAfter, null);
  assert.equal(rateLimitHeaders({ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }).retryAfter, "Wed, 21 Oct 2026 07:28:00 GMT");
});

test("본문 크기 미확인·과대·압축 응답은 읽지 않으며 본문 지연·실패가 예약 오류 처리를 막지 않는다", async () => {
  for (const headers of [{}, { "content-length": "50000" }, { "content-length": "10", "content-encoding": "gzip" }]) {
    await collectRateLimitDiagnostics({ headers: () => ({ "content-type": "text/html", ...headers }), body: () => assert.fail("본문을 요청하면 안 됨") });
  }
  const value = await collectRateLimitDiagnostics({ headers: () => ({ "content-type": "text/plain", "content-length": "10" }), body: () => new Promise(() => {}) }, { timeoutMs: 10 });
  assert.equal(value.bodyInspection, "unavailable"); assert.equal(value.sourceHint, "undetermined");
  assert.deepEqual(rateLimitNotice("<script>Cloudflare access denied</script>verify human CAPTCHA"), { notices: ["보안 확인 안내"], edgeBrand: null });
});
