import { ROOM_NAMES } from './config.js';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { validateCampSites } from './camp-site-identity.js';

export const CAMP_ROOT = 'https://www.swimozicamp.com/camp/';
export const SITE_VERSION = 'swimozicamp-v1';
export const catalog = new Map(ROOM_NAMES.map((name, index) => [name, { name, siteId: index + 1, displayName: name.split('_').reverse().join('') }]));
let catalogFile;
let verifiedCatalog = { checkedAt: 0, entries: [] };
export const catalogSnapshot = () => structuredClone(verifiedCatalog);
let writes = Promise.resolve();
export async function initCatalog(file) {
  catalogFile = file;
  let saved;
  try { saved = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; return; }
  const restored = new Map();
  for (const room of saved) {
    if (!Number.isSafeInteger(room.siteId) || room.siteId < 1 || canonicalName(room.displayName) !== room.name) throw new Error('저장된 사이트 목록 형식을 확인해 주세요.');
    if (restored.has(room.name) || [...restored.values()].some(item => item.siteId === room.siteId)) throw new Error('저장된 사이트 번호가 충돌합니다.');
    restored.set(room.name, room);
  }
  catalog.clear();
  for (const [name, room] of restored) catalog.set(name, room);
  try { const checked = JSON.parse(await readFile(file + '.verified', 'utf8')); if (Number.isSafeInteger(checked.checkedAt) && checked.checkedAt > 0 && Array.isArray(checked.entries)) verifiedCatalog = checked; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export async function saveVerifiedCatalog(entries, checkedAt) {
  const snapshot = { checkedAt, entries: structuredClone(entries) };
  if (catalogFile) { await writeFile(catalogFile + '.verified.tmp', JSON.stringify(snapshot), { mode: 0o600 }); await rename(catalogFile + '.verified.tmp', catalogFile + '.verified'); }
  catalog.clear(); for (const room of entries) catalog.set(room.name, room);
  await persistCatalog(); verifiedCatalog = snapshot;
}
export async function persistCatalog() {
  if (!catalogFile) return;
  const body = JSON.stringify([...catalog.values()]);
  writes = writes.catch(() => {}).then(async () => { await writeFile(`${catalogFile}.tmp`, body, { mode: 0o600 }); await rename(`${catalogFile}.tmp`, catalogFile); });
  await writes;
}
export function checkoutDate(startDate, nights = 1) {
  const date = new Date(`${startDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(nights) || nights < 1 || nights > 6 || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== startDate) throw new Error('숙박 날짜·박수를 확인해 주세요.');
  date.setUTCDate(date.getUTCDate() + nights);
  return date.toISOString().slice(0, 10);
}
export function campUrl(config, page = '', siteId) {
  const url = new URL(page, CAMP_ROOT);
  url.search = new URLSearchParams({ ci: config.startDate, co: checkoutDate(config.startDate, config.nights), ad: String(config.adults || 2), ch: '0', in: '0', ...(siteId ? { site: String(siteId) } : {}) }).toString();
  return url.href;
}
export function canonicalName(displayName) {
  const text = String(displayName || '').replace(/\s+/g, '').slice(0, 80);
  const match = /^(하늘존|산맥존)(.+)$/.exec(text);
  return match ? `${match[2]}_${match[1]}` : text;
}
// Passed to page.evaluate: only public room cards, never private booking links.
export function readCampListing() {
  return { recognized: Boolean(document.querySelector('.room-list')), cards: [...document.querySelectorAll('a.room-card[href]')].map(card => ({ href: card.href, displayName: card.querySelector('.room-name')?.textContent?.trim() || '' })) };
}
export function mergeListing(parsed, config) {
  if (!parsed.recognized) throw new Error('새 사이트의 정상적인 빈자리 목록을 확인하지 못했습니다. 빈자리 0개로 처리하지 않습니다.');
  const result = validateCampSites(parsed, { root: CAMP_ROOT, checkin: config.startDate, checkout: checkoutDate(config.startDate, config.nights) }, [...catalog.values()]);
  if (!result.ok) throw Object.assign(new Error('공식 사이트 이름·번호·URL·숙박 기간이 일치하지 않거나 중복되었습니다. 최종 제출하지 않습니다.'), { code: result.code, safeToLog: true });
  const cards = result.cards;
  // Retire stale aliases for reused numbers, without rewriting saved preferences.
  // A site absent from the live list is never eligible for this lookup/run.
  for (const [name, room] of catalog) if (!cards.some(card => card.name === name) && cards.some(card => card.siteId === room.siteId)) catalog.delete(name);
  for (const card of cards) catalog.set(card.name, card);
  return [...catalog.values()].map(room => ({ ...room, available: cards.some(card => card.siteId === room.siteId), status: cards.some(card => card.siteId === room.siteId) ? 'available' : 'unavailable', serverProvided: true, options: [] }));
}
