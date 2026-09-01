export const SEOUL_OFFSET = "+09:00";
export const BASE_URL = "http://newpension.logosweb.or.kr/reservation/reservation1.php?id=swim";

export const ROOM_NAMES = [
  "해_하늘존", "달_하늘존", "별_하늘존", "빛_하늘존", "강_하늘존", "산_하늘존", "들_하늘존",
  "숲_하늘존", "샘_산맥존", "온_산맥존", "숨_산맥존", "꿈_산맥존", "솔_산맥존", "결_산맥존"
];

export function defaultConfig(now = new Date()) {
  const currentYear = Number(formatSeoul(now, "year"));
  const currentMonth = Number(formatSeoul(now, "month"));
  const start = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
  const startDate = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-01`;
  const profile1 = emptyProfile();
  return {
    startDate,
    triggerAt: bookingOpenIso(startDate),
    nights: 1,
    bookingMode: "priority",
    roomPriority: ROOM_NAMES.map((name) => ({ name, enabled: false })),
    profile: profile1,
    profile1,
    profile2: emptyProfile(),
    useSecondProfile: false,
    autoFinalSubmit: true
  };
}

export function normalizeConfig(input = {}) {
  const ordered = [];
  for (const room of Array.isArray(input.roomPriority) ? input.roomPriority : []) {
    const name = normalizeRoomName(room?.name);
    if (name && !ordered.some((item) => item.name === name)) {
      ordered.push({ name, enabled: Boolean(room.enabled) });
    }
  }
  for (const name of ROOM_NAMES) {
    if (!ordered.some((item) => item.name === name)) ordered.push({ name, enabled: false });
  }

  const profile1 = normalizeProfile(input.profile1 || input.profiles?.[0] || input.profile);
  const profile2 = normalizeProfile(input.profile2 || input.profiles?.[1]);
  return {
    startDate: String(input.startDate || ""),
    triggerAt: String(input.triggerAt || ""),
    nights: Number(input.nights),
    bookingMode: input.bookingMode === "multiple" ? "multiple" : "priority",
    roomPriority: ordered,
    profile: profile1,
    profile1,
    profile2,
    useSecondProfile: Boolean(input.useSecondProfile),
    autoFinalSubmit: input.autoFinalSubmit !== false
  };
}

function normalizeRoomName(value) {
  const name = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return name.slice(0, 80);
}

export function validateConfig(config, { futureTrigger = false, nowMs = Date.now() } = {}) {
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.startDate) || !Number.isFinite(startEpoch(config.startDate))) {
    errors.push("숙박 시작 날짜");
  }
  if (!Number.isInteger(config.nights) || config.nights < 1 || config.nights > 6) errors.push("박수");
  if (!config.roomPriority.some((room) => room.enabled)) errors.push("예약할 객실");
  if (config.bookingMode === "multiple" && config.roomPriority.filter((room) => room.enabled).length > 5) errors.push("동시 예약 객실은 최대 5개");
  validateProfile(config.profile1 || config.profile, "예약자 1", errors);
  if (config.useSecondProfile) {
    validateProfile(config.profile2, "예약자 2", errors);
    if (config.bookingMode !== "priority") errors.push("예약자 2명 사용은 1개 예약 · 우선순위 방식에서만 지원");
  }
  const trigger = triggerEpoch(config.triggerAt);
  if (!Number.isFinite(trigger)) errors.push("예약 실행 시각");
  else if (futureTrigger && trigger <= nowMs) errors.push("현재 이후의 예약 실행 시각");
  return errors;
}

function emptyProfile() {
  return { reserverName: "", depositorName: "", phone: "", birthDate: "" };
}

function normalizeProfile(profile = {}) {
  return {
    reserverName: String(profile?.reserverName || "").trim(),
    depositorName: String(profile?.depositorName || "").trim(),
    phone: String(profile?.phone || "").replace(/\D/g, ""),
    birthDate: String(profile?.birthDate || "").replace(/\D/g, "").slice(0, 8)
  };
}

function validateProfile(profile, label, errors) {
  if (!profile?.reserverName) errors.push(`${label} 예약자명`);
  if (!profile?.depositorName) errors.push(`${label} 입금자명`);
  if (!/^01\d{8,9}$/.test(profile?.phone || "")) errors.push(`${label} 휴대폰 번호`);
  if (!/^\d{8}$/.test(profile?.birthDate || "")) errors.push(`${label} 생년월일 8자리`);
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
