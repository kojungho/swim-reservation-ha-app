export function normalizeLookupProfiles(input) {
  if (!Array.isArray(input) || input.length > 20) throw new Error("조회 대상은 최대 20명까지 사용할 수 있습니다.");
  return input.map((profile, index) => {
    profile ||= {};
    const reserverName = String(profile.reserverName || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
    const phone = String(profile.phone || "").replace(/\D/g, "");
    if (!reserverName || !/^01\d{8,9}$/.test(phone)) throw new Error(`조회 대상 ${index + 1}: 예약자명과 올바른 휴대폰 번호를 입력하세요.`);
    // Lookup-only records must never carry payment, birth date or booking preferences.
    return { reserverName, phone };
  });
}
