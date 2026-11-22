import { cardError } from './card-vault.js';

export const SAMSUNG_ORIGIN = 'https://vbv.samsungcard.co.kr';
export function samsungStep(address) {
  try { const u = new URL(address); return u.origin === SAMSUNG_ORIGIN ? /^\/VbV\/xacsv2\/WBVTFX(\d{3})\.jsp(?:;[^/]*)?$/.exec(u.pathname)?.[1] || null : null; }
  catch { return null; }
}
// An independent network boundary, not a preference that the UI can disable.
export class ReviewGuard {
  constructor() { this.frozen = false; this.orderPosts = 0; this.authPosts = 0; this.reachedPassword = false; this.blocked = 0; this.recentBlocked = []; }
  noteBlocked(request) {
    let host = 'external', resource = 'unrecognized-resource';
    try {
      const url = new URL(request.url());
      if (['www.swimozicamp.com','stdpay.inicis.com','vbv.samsungcard.co.kr'].includes(url.hostname)) host = url.hostname;
      const filename = url.pathname.split(';')[0].split('/').pop();
      if (/^(?:WBVTFX\d{3}\.jsp|[A-Za-z_-]+(?:Servlet|\.js|\.css))$/.test(filename)) resource = filename;
    } catch {}
    this.recentBlocked.push({ host, resource, method: ['GET','POST'].includes(request.method()) ? request.method() : 'OTHER' });
    this.recentBlocked = this.recentBlocked.slice(-8);
  }
  allow({ url, method = 'GET', navigation = false }) {
    if (this.frozen) return false;
    let u; try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
    // Official INIStdPay.js initializes from this separate static CDN.
    // Permit only static GET assets, never a navigation or payment endpoint.
    if (u.hostname === 'stdux.inicis.com') return method === 'GET' && !navigation && /^\/stdpay\/(?:stdjs|css|img|images|font|fonts)\/[A-Za-z0-9_./-]+\.(?:js|css|png|gif|jpg|jpeg|svg|woff2?|ttf|eot)$/.test(u.pathname) && !u.pathname.includes('..');
    if (!['www.swimozicamp.com', 'stdpay.inicis.com', 'vbv.samsungcard.co.kr'].includes(u.hostname)) return false;
    if (u.hostname === 'www.swimozicamp.com') {
      if (u.pathname === '/camp/pay_return.php' || u.pathname === '/camp/done.php') return false;
      if (method === 'POST') return u.pathname === '/camp/book.php' && this.orderPosts++ === 0;
      return method === 'GET' && (u.pathname.startsWith('/camp/') || u.pathname.startsWith('/assets/'));
    }
    if (u.hostname === 'stdpay.inicis.com') {
      // No merchant approval, auth/approval API, or result-return calls.
      if (method === 'POST') return u.pathname === '/payMain/pay' && !this.reachedPassword;
      return method === 'GET' && !/(?:approve|authComplete|payReturn)/i.test(u.pathname);
    }
    const step = samsungStep(url);
    if (navigation) {
      if (step === '301') { if (this.authPosts++ > 0) return false; this.reachedPassword = true; return true; }
      if (this.reachedPassword) return false;
      return ['400', '300'].includes(step);
    }
    // Only key initialization/static resources may be fetched outside navigation.
    // No arbitrary issuer AJAX POSTs: unknown protocol stops for review.
    return method === 'GET' && !/(?:approve|payment|certProc|authProc)/i.test(u.pathname);
  }
  freeze() { this.frozen = true; }
  async install(context) {
    await context.route('**/*', async route => {
      const request = route.request();
      if (this.allow({ url: request.url(), method: request.method(), navigation: request.isNavigationRequest() })) return route.continue();
      this.blocked++; this.noteBlocked(request); return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**', socket => socket.close());
  }
  async stopNetwork(context) { this.freeze(); await context.setOffline(true); }
}
export function assertSamsungPage(page, expected) {
  if (samsungStep(page.url()) !== expected) throw cardError('ISSUER_PAGE_MISMATCH');
}
