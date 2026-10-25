export const SEOUL_OFFSET = "+09:00";
export const MAX_SAVED_PROFILES = 20;
export function parallelProfileLimit(config) { return Math.max(1, new Set((config.roomPriority || []).map(room => room.name).filter(Boolean)).size); }
export const BASE_URL = "https://newpension.logosweb.or.kr/reservation/reservation1.php?id=swim";

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
    multipleProfileIndex: 0,
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

  const profiles = getProfiles(input).map(normalizeProfile);
  const profile1 = profiles[0];
  const profile2 = profiles[1] || normalizeProfile(input.profile2);
  return {
    startDate: String(input.startDate || ""),
    siteVersion: 'swimozicamp-v1',
    adults: Number(input.adults || 2),
    arrivalTime: String(input.arrivalTime || ''),
    request: String(input.request || '').slice(0, 1000),
    paymentMethod: String(input.paymentMethod || 'bank'),
    triggerAt: String(input.triggerAt || ""),
    nights: Number(input.nights),
    bookingMode: ["multiple", "profiles-parallel"].includes(input.bookingMode) ? input.bookingMode : "priority",
    multipleProfileIndex: Number(input.multipleProfileIndex ?? 0),
    editorProfileIndex: Math.max(0, Math.min(MAX_SAVED_PROFILES - 1, Math.trunc(Number(input.editorProfileIndex ?? input.multipleProfileIndex ?? 0) || 0))),
    roomPriority: ordered,
    profile: profile1,
    profile1,
    profile2,
    profiles,
    useSecondProfile: profiles.length > 1,
    autoFinalSubmit: input.autoFinalSubmit !== false
  };
}

function normalizeRoomName(value) {
  const name = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return name.slice(0, 80);
}

export function validateConfig(config, { futureTrigger = false, nowMs = Date.now() } = {}) {
  const errors = [];
  if (config.adults !== undefined && ![1, 2].includes(config.adults)) errors.push('성인 인원 (1~2명)');
  if (config.paymentMethod && config.paymentMethod !== 'bank') errors.push('현재 자동 예약은 무통장입금만 가능 (다른 결제는 공식 사이트에서 직접 진행)');
  if (config.arrivalTime && !['14:00 ~ 15:00', '15:00 ~ 16:00', '16:00 ~ 17:00', '17:00 ~ 18:00', '18:00 ~ 19:00', '19:00 이후'].includes(config.arrivalTime)) errors.push('도착 예정 시간');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.startDate) || !Number.isFinite(startEpoch(config.startDate))) {
    errors.push("숙박 시작 날짜");
  }
  if (!Number.isInteger(config.nights) || config.nights < 1 || config.nights > 6) errors.push("박수");
  if (config.bookingMode !== "profiles-parallel" && !config.roomPriority.some((room) => room.enabled)) errors.push("예약할 객실");
  if (config.bookingMode === "multiple" && config.roomPriority.filter((room) => room.enabled).length > 5) errors.push("동시 예약 객실은 최대 5개");
  const profiles = getProfiles(config);
  const profileLimit = config.bookingMode === "profiles-parallel" ? parallelProfileLimit(config) : MAX_SAVED_PROFILES;
  if (profiles.length < 1 || profiles.length > profileLimit) errors.push(`예약자는 1~${profileLimit}명까지 등록 가능${config.bookingMode === "profiles-parallel" ? " (객실 수 기준)" : ""}`);
  profiles.forEach((profile, index) => validateProfile(profile, `예약자 ${index + 1}`, errors));
  if (config.bookingMode === "multiple" && (!Number.isInteger(config.multipleProfileIndex) || !profiles[config.multipleProfileIndex])) errors.push("다중 예약에 사용할 예약자");
  if (config.bookingMode === "profiles-parallel") profiles.forEach((profile, index) => {
    if (!profile.roomPriority?.some(room => room.enabled)) errors.push(`예약자 ${index + 1}의 예약할 객실`);
  });
  const trigger = triggerEpoch(config.triggerAt);
  if (!Number.isFinite(trigger)) errors.push("예약 실행 시각");
  else if (futureTrigger && trigger <= nowMs) errors.push("현재 이후의 예약 실행 시각");
  return errors;
}

export function getProfiles(config) {
  if (Array.isArray(config.profiles)) return config.profiles;
  const profiles = [config.profile1 || config.profile || emptyProfile()];
  if (config.useSecondProfile) profiles.push(config.profile2 || emptyProfile());
  return profiles;
}

function emptyProfile() {
  return { reserverName: "", depositorName: "", phone: "", birthDate: "" };
}

export function normalizeProfile(profile = {}) {
  return {
    reserverName: String(profile?.reserverName || "").trim(),
    depositorName: String(profile?.depositorName || "").trim(),
    phone: String(profile?.phone || "").replace(/\D/g, ""),
    birthDate: String(profile?.birthDate || "").replace(/\D/g, "").slice(0, 8),
    roomPriority: [...new Map((Array.isArray(profile?.roomPriority) ? profile.roomPriority : [])
      .map(room => ({ name: normalizeRoomName(room?.name), enabled: Boolean(room?.enabled) }))
      .filter(room => room.name).map(room => [room.name, room])).values()]
  };
}

export function validateProfile(profile, label, errors) {
  if (!profile?.reserverName) errors.push(`${label} 예약자명`);
  if (!/^01\d{8,9}$/.test(profile?.phone || "")) errors.push(`${label} 휴대폰 번호`);
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
