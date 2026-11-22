import { randomBytes, timingSafeEqual } from 'node:crypto';
import { CardVault, cardError } from './card-vault.js';
import { CardReview, REVIEW_ERRORS, reviewInput } from './card-review.js';
import { createReviewFixture, FIXTURE_CARD } from './card-review-fixture.js';
import { catalog } from './camp-site.js';

export class CardReviewApi {
  constructor({ dataDir, store, canStart, executablePath }) {
    this.vault = new CardVault(dataDir); this.store = store; this.canStart = canStart;
    this.review = new CardReview({ executablePath, log: (...args) => store.recordLog(...args) });
    this.csrf = randomBytes(32).toString('hex'); this.pending = false; this.failedUnlocks = 0; this.unlockAfter = 0;
  }
  get busy() { return this.pending || this.review.busy; }
  async close() { return this.review.stop(); }
  async handle(request, response, url) {
    if (!url.pathname.startsWith('/api/card-review')) return false;
    const reply = (code, data) => { response.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(data)); return true; };
    let input, acquired = false;
    try {
      if (url.pathname === '/api/card-review' && request.method === 'GET') return reply(200, { vault: await this.vault.status(), review: this.review.status(), csrf: this.csrf });
      if (url.pathname === '/api/card-review/options' && request.method === 'GET') return reply(200, { profiles: (await this.store.getSavedProfiles()).map((p, index) => ({ index, name: p.reserverName })), sites: [...catalog.values()].map(s => ({ id: s.siteId, name: s.name })) });
      if (!['POST', 'PUT', 'DELETE'].includes(request.method) || !['/api/card-review/vault', '/api/card-review/start', '/api/card-review/self-test', '/api/card-review/stop'].includes(url.pathname)) return reply(404, { code: 'NOT_FOUND' });
      const supplied = Buffer.from(String(request.headers['x-swim-card-review'] || ''));
      if (supplied.length !== 64 || !timingSafeEqual(supplied, Buffer.from(this.csrf)) || request.headers['sec-fetch-site'] === 'cross-site') return reply(403, { code: 'REVIEW_FORBIDDEN', error: '검토 화면을 다시 열어 주세요.' });
      if (this.pending) throw cardError('REVIEW_BUSY');
      if (url.pathname === '/api/card-review/stop' && request.method === 'POST') { await this.review.stop(); return reply(200, { review: this.review.status() }); }
      if (this.review.busy || !this.canStart()) throw cardError('REVIEW_BUSY');
      this.pending = true; acquired = true;
      if (url.pathname === '/api/card-review/vault' && request.method === 'DELETE') return reply(200, { vault: await this.vault.remove() });
      input = await readPrivateBody(request);
      if (url.pathname === '/api/card-review/vault' && request.method === 'PUT') return reply(200, { vault: await this.vault.save(input, input.passphrase) });
      if (url.pathname === '/api/card-review/self-test' && request.method === 'POST') {
        const config = { startDate: '2027-01-27', nights: 1, adults: 2, siteId: 1, amount: 60000, profile: { reserverName: '로컬 검토', phone: '01000000000' } };
        return reply(202, { review: this.review.start(config, { ...FIXTURE_CARD }, { fixture: createReviewFixture(config) }) });
      }
      if (url.pathname === '/api/card-review/start' && request.method === 'POST') {
        if (Date.now() < this.unlockAfter) return reply(429, { error: '해제 시도가 많습니다. 1분 뒤 다시 시도하세요.' });
        const config = reviewInput(input, await this.store.getSavedProfiles());
        let card;
        try { card = await this.vault.open(input.passphrase); this.failedUnlocks = 0; }
        catch (error) { if (++this.failedUnlocks >= 5) { this.unlockAfter = Date.now() + 60000; this.failedUnlocks = 0; } throw error; }
        if (!this.canStart()) { for (const key of Object.keys(card)) card[key] = ''; throw cardError('REVIEW_BUSY'); }
        return reply(202, { review: this.review.start(config, card) });
      }
      return reply(405, { code: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      const code = Object.hasOwn(REVIEW_ERRORS, error.code) ? error.code : 'REVIEW_FAILED';
      // Never send exception text, request bodies, Playwright call logs or stack traces.
      return reply(code === 'REVIEW_BUSY' ? 409 : 400, { code, error: REVIEW_ERRORS[code] });
    } finally { if (input) for (const key of Object.keys(input)) input[key] = null; if (acquired) this.pending = false; }
  }
}
async function readPrivateBody(request) {
  const chunks = []; let size = 0;
  try {
    for await (const chunk of request) { size += chunk.length; if (size > 4096) throw cardError('REVIEW_INPUT'); chunks.push(chunk); }
    const buffer = Buffer.concat(chunks); try { const result = JSON.parse(buffer.toString('utf8') || '{}'); if (!result || Array.isArray(result) || typeof result !== 'object') throw cardError('REVIEW_INPUT'); return result; } finally { buffer.fill(0); }
  } finally { for (const chunk of chunks) chunk.fill(0); }
}
