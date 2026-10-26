// Name format only, not identity verification. Preserve international names.
export function validPersonName(value) {
  if (typeof value !== 'string') return false;
  const name=value.trim().normalize('NFC');
  return name.length>0&&name.length<=50&&!/[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]/u.test(name)&&/^\p{L}[\p{L}\p{M}]*(?:[ '\u2019·-]\p{L}[\p{L}\p{M}]*)*$/u.test(name);
}
