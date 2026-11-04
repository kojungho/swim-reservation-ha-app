// Pure function mirrored in the Android offline/online engine. No network or DOM.
export function validateCampSites(parsed, expected, known = []) {
  const fail = () => ({ ok: false, code: 'CATALOG_MISMATCH' });
  try {
    if (!parsed.recognized || !Array.isArray(parsed.cards)) return fail();
    const root = new URL(expected.root), cards = [], ids = new Set(), names = new Set();
    for (const raw of parsed.cards) {
      const url = new URL(raw.href, root);
      const single = (key, value) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value;
      const value = url.searchParams.get('site'), siteId = Number(value);
      const displayName = String(raw.displayName || '').replace(/\s+/g, '');
      if (url.origin !== root.origin || url.username || url.password || url.hash || url.pathname !== '/camp/site.php'
        || !single('ci', expected.checkin) || !single('co', expected.checkout)
        || !single('site', value) || !/^[1-9]\d{0,4}$/.test(value || '') || siteId > 10000
        || !displayName || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) return fail();
      const match = /^(하늘존|산맥존)(.+)$/.exec(displayName);
      const name = match ? `${match[2]}_${match[1]}` : displayName;
      // Fresh official links override cached numbers. Preferences remain keyed by
      // name; only ambiguity within this fresh response prevents resolution.
      if (name.length > 80 || ids.has(siteId) || names.has(name)) return fail();
      ids.add(siteId); names.add(name); cards.push({ name, displayName, siteId });
    }
    return { ok: true, cards, added: cards.filter(card => !known.some(room => room.name === card.name)).map(card => card.name), changed: cards.filter(card => known.some(room => room.name === card.name && room.siteId !== card.siteId)).map(card => card.name) };
  } catch { return fail(); }
}
