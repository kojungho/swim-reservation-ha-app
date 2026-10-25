export function safeReservationUrl(value) {
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return `${url.origin}${url.pathname}`;
  } catch { return ""; }
}
export function reservationErrorDetails(error, extra = {}) {
  const message = String(error?.message || error || "알 수 없는 오류")
    .replace(/https?:\/\/[^\s"<>]+/g, value => safeReservationUrl(value))
    .replace(/\b(?:\d[ -]?){6,}\d\b/g, "[번호 생략]").slice(0, 1200);
  return { code: error?.code || "RESERVATION_ERROR", message,
    ...(error?.step ? { step: error.step } : {}), ...(error?.substep ? { substep: error.substep } : {}),
    ...(error?.failureKind ? { failureKind: error.failureKind } : {}), ...(error?.checks ? { checks: error.checks } : {}), ...extra };
}
