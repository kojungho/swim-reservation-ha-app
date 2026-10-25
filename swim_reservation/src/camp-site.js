import { ROOM_NAMES } from './config.js';
import { readFile, writeFile, rename } from 'node:fs/promises';

export const CAMP_ROOT = 'https://www.swimozicamp.com/camp/';
export const SITE_VERSION = 'swimozicamp-v1';
export const catalog = new Map(ROOM_NAMES.map((name, index) => [name, { name, siteId: index + 1, displayName: name.split('_').reverse().join('') }]));
let catalogFile;
let writes = Promise.resolve();
export async function initCatalog(file) {
  catalogFile = file;
  let saved;
  try { saved = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; return; }
  for (const room of saved) {
    if (!Number.isSafeInteger(room.siteId) || room.siteId < 1 || canonicalName(room.displayName) !== room.name) throw new Error('저장된 사이트 목록 형식을 확인해 주세요.');
    const existing = [...catalog.values()].find(item => item.siteId === room.siteId || item.name === room.name);
    if (existing && (existing.name !== room.name || existing.siteId !== room.siteId)) throw new Error('저장된 사이트 번호가 충돌합니다.');
    catalog.set(room.name, room);
  }
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
  const cards = parsed.cards.map(card => {
    const url = new URL(card.href);
    const id = Number(url.searchParams.get('site'));
    if (url.origin !== new URL(CAMP_ROOT).origin || url.pathname !== '/camp/site.php' || url.searchParams.get('ci') !== config.startDate || url.searchParams.get('co') !== checkoutDate(config.startDate, config.nights) || !Number.isSafeInteger(id) || id < 1 || !card.displayName) throw new Error('사이트 목록의 날짜 또는 사이트 식별값이 다릅니다.');
    return { siteId: id, name: canonicalName(card.displayName), displayName: card.displayName };
  });
  const combined = new Map(catalog);
  for (const card of cards) {
    const old = combined.get(card.name);
    if (old && old.siteId !== card.siteId) throw new Error('기존 사이트의 번호가 변경되었습니다. 자동 예약을 중지합니다.');
    if ([...combined.values()].some(item => item.siteId === card.siteId && item.name !== card.name)) throw new Error('사이트 번호와 이름이 충돌합니다. 자동 예약을 중지합니다.');
    combined.set(card.name, card);
  }
  for (const card of cards) catalog.set(card.name, card);
  return [...catalog.values()].map(room => ({ ...room, available: cards.some(card => card.siteId === room.siteId), status: cards.some(card => card.siteId === room.siteId) ? 'available' : 'unavailable', serverProvided: true, options: [] }));
}
