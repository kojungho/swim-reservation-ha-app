package kr.swim.phone;
/** Format validation, not real-name verification. Allows international letters. */
final class PersonName {
 static boolean valid(String value){
  if(value==null)return false;
  String name=java.text.Normalizer.normalize(value.trim(),java.text.Normalizer.Form.NFC);
  return !name.isEmpty()&&name.length()<=50&&!name.matches(".*[\\u1100-\\u11ff\\u3130-\\u318f\\ua960-\\ua97f\\ud7b0-\\ud7ff].*")&&name.matches("\\p{L}[\\p{L}\\p{M}]*(?:[ '\u2019·-]\\p{L}[\\p{L}\\p{M}]*)*");
 }
}
