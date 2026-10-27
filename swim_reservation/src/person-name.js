// Name format only, not identity verification. Completed Hangul only.
export function validPersonName(value) {
  if (typeof value !== 'string') return false;
  const name=value.trim().normalize('NFC');
  return /^[가-힣]{2,50}$/u.test(name);
}
