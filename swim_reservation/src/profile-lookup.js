export async function lookupProfiles(profiles, manager) {
  const reservations = [], lookupErrors = [], lookupStatuses = [];
  for (const [index, profile] of profiles.entries()) {
    const identity = { profileIndex: index, profileLabel: `예약자 ${index + 1} · ${profile.reserverName}` };
    try {
      const found = await manager.list(profile);
      reservations.push(...found.map(item => ({ ...item, ...identity })));
      lookupStatuses.push({ ...identity, count: found.length });
    } catch (error) {
      lookupErrors.push({ ...identity, message: error.message });
      lookupStatuses.push({ ...identity, error: true });
    }
  }
  return { ok: !lookupErrors.length, reservations, lookupErrors, lookupStatuses };
}
