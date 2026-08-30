import iconv from "iconv-lite";

const CHECK_URL = "http://newpension.logosweb.or.kr/reservation/order_ok7.php?id=swim";

export function reservationCheckUrl(profile = {}) {
  const name = String(profile.reserverName || "").trim();
  const phone = String(profile.phone || "").replace(/\D/g, "");
  if (!name) throw new Error("예약자명을 먼저 저장해 주세요.");
  if (!/^01\d{8,9}$/.test(phone)) throw new Error("올바른 휴대폰 번호를 먼저 저장해 주세요.");

  const tel1 = phone.slice(0, 3);
  const tel3 = phone.slice(-4);
  const tel2 = phone.slice(3, -4);
  return `${CHECK_URL}&name=${encodeEucKr(name)}&tel1=${tel1}&tel2=${tel2}&tel3=${tel3}`;
}

function encodeEucKr(value) {
  return [...iconv.encode(value, "euc-kr")].map((byte) => {
    const character = String.fromCharCode(byte);
    return /[A-Za-z0-9._~-]/.test(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}
