// GET-only opening readiness, shared timing contract with Android OpeningReadiness.
export const OPENING_DELAYS = [1000, 1000, 2000, 3000];
export function openingRetryDelay({ submitted = false, notice = '', reads, trigger, now }) {
  const delay = OPENING_DELAYS[reads - 1];
  if (submitted || !/체크인까지|오픈|예약.*시작|아직/.test(notice) || !Number.isInteger(reads) || reads < 1 || delay === undefined || !Number.isFinite(trigger) || trigger <= 0 || now < trigger || now + delay > trigger + 10000) return null;
  return delay;
}
