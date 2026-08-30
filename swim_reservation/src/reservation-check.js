import iconv from "iconv-lite";

const CHECK_URL = "http://newpension.logosweb.or.kr/reservation/order_ok7.php?id=swim";

export function reservationCheckUrl(profile = {}) {
  return `${CHECK_URL}&${profileQuery(profile)}`;
}

export function reservationCancelUrl(profile = {}, reservationId) {
  const id = String(reservationId || "");
  if (!/^\d+$/.test(id)) throw new Error("취소할 예약 식별값이 올바르지 않습니다.");
  return `http://newpension.logosweb.or.kr/reservation/order_del3.php?no=${id}&id=swim&${profileQuery(profile)}`;
}

function profileQuery(profile) {
  const name = String(profile.reserverName || "").trim();
  const phone = String(profile.phone || "").replace(/\D/g, "");
  if (!name) throw new Error("예약자명을 먼저 저장해 주세요.");
  if (!/^01\d{8,9}$/.test(phone)) throw new Error("올바른 휴대폰 번호를 먼저 저장해 주세요.");

  const tel1 = phone.slice(0, 3);
  const tel3 = phone.slice(-4);
  const tel2 = phone.slice(3, -4);
  return `name=${encodeEucKr(name)}&tel1=${tel1}&tel2=${tel2}&tel3=${tel3}`;
}

function encodeEucKr(value) {
  return [...iconv.encode(value, "euc-kr")].map((byte) => {
    const character = String.fromCharCode(byte);
    return /[A-Za-z0-9._~-]/.test(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}
