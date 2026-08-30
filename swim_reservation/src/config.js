export const SEOUL_OFFSET = "+09:00";
export const BASE_URL = "http://newpension.logosweb.or.kr/reservation/reservation1.php?id=swim";

export const ROOM_NAMES = [
  "해_하늘존", "달_하늘존", "별_하늘존", "빛_하늘존", "강_하늘존", "산_하늘존", "들_하늘존",
  "숲_하늘존", "샘_산맥존", "숨_산맥존", "꿈_산맥존", "솔_산맥존", "결_산맥존"
];

export function defaultConfig(now = new Date()) {
  const currentYear = Number(formatSeoul(now, "year"));
  const currentMonth = Number(formatSeoul(now, "month"));
  const start = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
  const startDate = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-01`;
  return {
    startDate,
    triggerAt: bookingOpenIso(startDate),
    nights: 1,
    bookingMode: "priority",
    roomPriority: ROOM_NAMES.map((name) => ({ name, enabled: false })),
    profile: { reserverName: "", depositorName: "", phone: "", birthDate: "" },
    autoFinalSubmit: true
  };
}

export function normalizeConfig(input = {}) {
  const knownRooms = new Map(
    (Array.isArray(input.roomPriority) ? input.roomPriority : []).map((room) => [room?.name, room])
  );
  const ordered = [];
  for (const room of Array.isArray(input.roomPriority) ? input.roomPriority : []) {
    if (ROOM_NAMES.includes(room?.name) && !ordered.some((item) => item.name === room.name)) {
      ordered.push({ name: room.name, enabled: Boolean(room.enabled) });
    }
  }
  for (const name of ROOM_NAMES) {
    if (!knownRooms.has(name)) ordered.push({ name, enabled: false });
  }

  return {
    startDate: String(input.startDate || ""),
    triggerAt: String(input.triggerAt || ""),
    nights: Number(input.nights),
    bookingMode: input.bookingMode === "multiple" ? "multiple" : "priority",
    roomPriority: ordered,
    profile: {
      reserverName: String(input.profile?.reserverName || "").trim(),
      depositorName: String(input.profile?.depositorName || "").trim(),
      phone: String(input.profile?.phone || "").replace(/\D/g, ""),
      birthDate: String(input.profile?.birthDate || "").replace(/\D/g, "").slice(0, 8)
    },
    autoFinalSubmit: input.autoFinalSubmit !== false
  };
}

export function validateConfig(config, { futureTrigger = false } = {}) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.startDate) || !Number.isFinite(startEpoch(config.startDate))) {
    errors.push("숙박 시작 날짜");
  }
  if (!Number.isInteger(config.nights) || config.nights < 1 || config.nights > 6) errors.push("박수");
  if (!config.roomPriority.some((room) => room.enabled)) errors.push("예약할 객실");
  if (config.bookingMode === "multiple" && config.roomPriority.filter((room) => room.enabled).length > 5) errors.push("동시 예약 객실은 최대 5개");
  if (!config.profile.reserverName) errors.push("예약자명");
  if (!config.profile.depositorName) errors.push("입금자명");
  if (!/^01\d{8,9}$/.test(config.profile.phone)) errors.push("휴대폰 번호");
  if (!/^\d{8}$/.test(config.profile.birthDate)) errors.push("생년월일 8자리");
  const trigger = triggerEpoch(config.triggerAt);
  if (!Number.isFinite(trigger)) errors.push("예약 실행 시각");
  else if (futureTrigger && trigger <= Date.now()) errors.push("현재 이후의 예약 실행 시각");
  return errors;
}

export function reservationUrl(startDate) {
  const url = new URL(BASE_URL);
  url.searchParams.set("adaystart", String(Math.floor(startEpoch(startDate) / 1000)));
  return url.href;
}

export function startEpoch(startDate) {
  return Date.parse(`${startDate}T00:00:00${SEOUL_OFFSET}`);
}

export function triggerEpoch(value) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(String(value))) {
    return Date.parse(`${value.length === 16 ? `${value}:00` : value}${SEOUL_OFFSET}`);
  }
  return Date.parse(value);
}

export function bookingOpenIso(startDate) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(startDate);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 3, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01T00:00:00`;
}

function formatSeoul(date, part) {
  const pieces = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit"
  }).formatToParts(date);
  return pieces.find((piece) => piece.type === part)?.value;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
