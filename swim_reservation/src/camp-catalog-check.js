import { CAMP_ROOT, catalog, campUrl, checkoutDate, readCampListing, saveVerifiedCatalog } from './camp-site.js';
import { validateCampSites } from './camp-site-identity.js';
import { setTimeout as sleep } from 'node:timers/promises';

const fail = code => Object.assign(new Error('사이트 목록 사전 점검을 완료하지 못했습니다.'), { code, safeToLog: true, step: 'site-catalog-check' });
// GET-only caller guard also covers these public detail pages. No personal fields.
export async function checkDailyCatalog(engine, config, dates, now, signal, {delayMs = 500} = {}) {
  const fingerprint = entries => JSON.stringify(entries.map(({name,siteId,displayName})=>({name,siteId,displayName})).sort((a,b)=>a.siteId-b.siteId));
  const before = [...catalog.values()], baseline = fingerprint(before), found = new Map();
  const stop = () => { if (signal?.aborted) throw fail('PREFLIGHT_INTERRUPTED'); };
  const first = dates[0];
  let reads = 0;
  const pace = async () => { stop(); if (reads++ && delayMs) await sleep(delayMs, undefined, {signal}); stop(); };
  if (!first || before.length > 128) throw fail('CATALOG_MISMATCH');
  for (const startDate of dates.slice(0, 7)) {
    await pace(); const trial = { ...config, startDate, nights: 1 };
    await engine.traceStep('catalog-list-fetch', () => engine.navigate(campUrl(trial)));
    const parsed = await engine.page.evaluate(readCampListing);
    const result = validateCampSites(parsed, { root: CAMP_ROOT, checkin: startDate, checkout: checkoutDate(startDate, 1) });
    if (!result.ok) throw fail(result.code);
    for (const room of result.cards) {
      const old = found.get(room.siteId);
      if (old && old.name !== room.name) throw fail('CATALOG_MISMATCH');
      found.set(room.siteId, room);
    }
  }
  const ids = [...new Set([...before.map(room => room.siteId), ...found.keys()])].sort((a,b) => a-b);
  if (ids.length > 128) throw fail('CATALOG_MISMATCH');
  const entries = [], names = new Set(), trial = { ...config, startDate: first, nights: 1 };
  for (const id of ids) {
    await pace(); await engine.traceStep('catalog-detail-fetch', () => engine.navigate(campUrl(trial, 'site.php', id)));
    const detail = await engine.page.evaluate(() => {
      const title = document.querySelectorAll('.detail-heading'), quote = document.querySelectorAll('form.js-quote');
      return { title: title.length === 1 ? title[0].textContent : '', count: quote.length, site: quote[0]?.dataset.site, ci: quote[0]?.dataset.ci, co: quote[0]?.dataset.co };
    });
    const result = validateCampSites({ recognized: true, cards: [{ href: engine.page.url(), displayName: detail.title }] }, { root: CAMP_ROOT, checkin: first, checkout: checkoutDate(first, 1) });
    // Detail URL is site.php too. Independent DOM identifiers must agree.
    if (!result.ok || detail.count !== 1 || detail.site !== String(id) || detail.ci !== first || detail.co !== checkoutDate(first, 1)) throw fail('CATALOG_MISMATCH');
    const room = result.cards[0];
    if (names.has(room.name) || found.has(id) && found.get(id).name !== room.name) throw fail('CATALOG_MISMATCH');
    names.add(room.name); entries.push(room);
  }
  stop(); if (fingerprint([...catalog.values()]) !== baseline) throw fail('CATALOG_CHANGED_DURING_CHECK');
  const checkedAt = Math.max(now, Date.now());
  await saveVerifiedCatalog(entries, checkedAt);
  const result = { checkedAt, checkedCount: entries.length, datesChecked: dates.length,
    addedSites: entries.filter(r => !before.some(old => old.name === r.name)).map(r => r.name),
    changedSites: entries.filter(r => before.some(old => old.siteId === r.siteId && old.name !== r.name || old.name === r.name && old.siteId !== r.siteId)).map(r => r.name) };
  engine.recordTrace('site-catalog-check', 'checks', result);
  await engine.onCatalogUpdated?.(entries);
  if ((config.preflightRequestedSites || []).some(name => !names.has(name))) throw fail('CATALOG_REQUESTED_SITE_MISSING');
  return result;
}
