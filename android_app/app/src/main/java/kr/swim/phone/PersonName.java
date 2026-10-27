package kr.swim.phone;
/** Format validation, not real-name verification. Completed Hangul only. */
final class PersonName {
 static boolean valid(String value){
  if(value==null)return false;
  String name=java.text.Normalizer.normalize(value.trim(),java.text.Normalizer.Form.NFC);
  return name.matches("[가-힣]{2,50}");
 }
}
