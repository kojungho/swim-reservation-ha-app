export async function lookupProfiles(profiles, manager, labelPrefix = "예약자", { signal } = {}) {
  const reservations = [], lookupErrors = [], lookupStatuses = [];
  for (const [index, profile] of profiles.entries()) {
    signal?.throwIfAborted();
    const identity = { profileIndex: index, profileLabel: profile.reserverName, profile: { reserverName: profile.reserverName, phone: profile.phone } };
    try {
      const found = await manager.list(profile, { profileIndex: index, signal });
      reservations.push(...found.map(item => ({ ...item, ...identity })));
      lookupStatuses.push({ ...identity, count: found.length });
    } catch (error) {
      if(signal?.aborted)throw error;
      lookupErrors.push({ ...identity, message: error.message });
      lookupStatuses.push({ ...identity, error: true });
    }
  }
  return { ok: !lookupErrors.length, reservations, lookupErrors, lookupStatuses };
}
