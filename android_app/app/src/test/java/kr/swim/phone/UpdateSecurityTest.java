package kr.swim.phone;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;
import java.net.URL;
public class UpdateSecurityTest {
 JSONObject metadata() throws Exception {return new JSONObject().put("packageId","kr.swim.phone").put("versionCode",31).put("versionName","0.4.25").put("sha256","a".repeat(64)).put("apkUrl","https://github.com/kojungho/swim-reservation-ha-app/releases/download/phone-v0.4.25/swim-phone-0.4.25.apk");}
 @Test public void digestIsMandatoryAndStrict() throws Exception {
  AppUpdates.validate(metadata());
  for(String bad:new String[]{"","abc","g".repeat(64),"a".repeat(63)}) {
   try {AppUpdates.validate(metadata().put("sha256",bad));fail("accepted invalid digest");} catch(Exception expected) {}
  }
  JSONObject missing=metadata();missing.remove("sha256");try{AppUpdates.validate(missing);fail("accepted missing digest");}catch(Exception expected){}
 }
 @Test public void redirectsCannotDowngradeOrEscapeHostAllowlist() throws Exception {
  assertTrue(ApkDownload.allowed(new URL("https://release-assets.githubusercontent.com/file")));
  for(String bad:new String[]{"http://github.com/file","https://github.com.evil.test/file","https://user@github.com/file","https://github.com:8443/file"}) assertFalse(ApkDownload.allowed(new URL(bad)));
 }
}
