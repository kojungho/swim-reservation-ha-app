package kr.swim.phone;
import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.*;
import android.content.Context;import android.graphics.Bitmap;import java.io.*;import javax.crypto.spec.SecretKeySpec;import org.json.*;import okhttp3.*;import okhttp3.mockwebserver.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class HaDisplayTest{
 Context c;
 @Before public void setup(){c=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");c.getSharedPreferences("phone-private",0).edit().clear().commit();}
 @After public void cleanup(){LocalStore.testKey=null;}
 @Test public void onlyHttpsOriginWithoutTokensOrPaths(){
  assertEquals("https://example.test:8123",HaDisplay.origin("https://example.test:8123/"));
  for(String bad:new String[]{"http://example.test","https://user:secret@example.test","https://example.test/path","https://example.test/?token=secret","https://example.test/#secret","javascript:alert(1)"}){try{HaDisplay.origin(bad);fail(bad);}catch(IllegalArgumentException expected){}}
 }
 JSONObject display(byte[] image)throws Exception{return new JSONObject().put("schema",1).put("settings",new JSONObject().put("appMenus",new JSONObject().put("watch",false)).put("phone","PRIVATE").put("appMenuLabels",new JSONObject().put("watch","대기")).put("fonts",new JSONObject().put("body",17))).put("photoSha256",HaDisplay.digest(image)).put("submitIntervalSeconds",0).put("access_token","PRIVATE");}
 byte[] png(){Bitmap bitmap=Bitmap.createBitmap(2,2,Bitmap.Config.ARGB_8888);ByteArrayOutputStream out=new ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,out);return out.toByteArray();}
 @Test public void strictlyProjectsPublicFieldsAndPreservesZeroInterval()throws Exception{
  JSONObject safe=HaDisplay.project(display(png()));assertFalse(safe.toString().contains("PRIVATE"));assertEquals(0,safe.getInt("submitIntervalSeconds"));assertEquals("대기",safe.getJSONObject("settings").getJSONObject("appMenuLabels").getString("watch"));
  for(Object bad:new Object[]{-1,61,0.5,true,"5"})try{HaDisplay.project(display(png()).put("submitIntervalSeconds",bad));fail("bad interval");}catch(IOException expected){}
 }
 @Test public void statusNeverExposesLegacyCredentials()throws Exception{
  HaDisplay.vault(c).saveDocument("ha-auth",new JSONObject().put("access_token","secret-access").put("refresh_token","secret-refresh"));
  HaDisplay.vault(c).saveDocument("ha-display",new JSONObject().put("settings",new JSONObject().put("appMenus",new JSONObject().put("watch",false))).put("updatedAt",1));
  String visible=HaDisplay.status(c).toString();assertFalse(visible.contains("secret"));assertTrue(visible.contains("appMenus"));
 }
 @Test public void allNativePhotoMutationsAndExportAreRejected()throws Exception{
  MainActivity a=new MainActivity();
  for(String action:new String[]{"mapPick","mapAction","mapExport","haConnect"}){JSONObject result=new JSONObject(a.api(new JSONObject().put("action",action).put("data",new JSONObject()).toString()));assertFalse(action,result.optBoolean("ok"));}
 }
 @Test public void anonymousGetOnlyCachesPhotoAndPreservesPrivateData()throws Exception{
  byte[] image=png();HaDisplay.vault(c).saveDocument("profiles",new JSONObject().put("private","KEEP"));
  try(MockWebServer server=new MockWebServer()){server.start();String base=server.url("/").toString().replaceAll("/$","");
   server.enqueue(new MockResponse().setBody(display(image).toString()));server.enqueue(new MockResponse().setBody(new okio.Buffer().write(image)));
   HaDisplay.refresh(c,base);assertTrue(HaDisplay.photo(c).isFile());
   for(String path:new String[]{"/api/swim_phone/display","/api/swim_phone/map"}){RecordedRequest r=server.takeRequest();assertEquals("GET",r.getMethod());assertEquals(path,r.getPath());assertNull(r.getHeader("Authorization"));assertNull(r.getHeader("Cookie"));}
   server.enqueue(new MockResponse().setBody(display(image).toString()));HaDisplay.refresh(c,base);
   assertEquals("/api/swim_phone/display",server.takeRequest().getPath());assertEquals(3,server.getRequestCount());
   assertEquals("KEEP",HaDisplay.vault(c).loadDocument("profiles").getString("private"));
  }
 }
 @Test public void failedOrMismatchedPhotoDoesNotReplaceCachedSettings()throws Exception{
  JSONObject previous=new JSONObject().put("settings",new JSONObject().put("watchInfo",true)).put("updatedAt",42);HaDisplay.vault(c).saveDocument("ha-display",previous);
  try(MockWebServer server=new MockWebServer()){server.start();String base=server.url("/").toString().replaceAll("/$","");
   server.enqueue(new MockResponse().setResponseCode(503));try{HaDisplay.refresh(c,base);fail();}catch(IOException expected){}
   server.enqueue(new MockResponse().setBody(display("EXPECTED".getBytes()).toString()));server.enqueue(new MockResponse().setBody("WRONG"));
   try{HaDisplay.refresh(c,base);fail();}catch(IOException expected){}
   assertEquals(previous.toString(),HaDisplay.vault(c).loadDocument("ha-display").toString());
  }
 }
 @Test public void redirectAndOversizeResponseAreRejected()throws Exception{
  try(MockWebServer server=new MockWebServer()){server.start();
   server.enqueue(new MockResponse().setResponseCode(302).setHeader("Location","https://other.test"));
   try{HaDisplay.get(server.url("/").toString(),32);fail();}catch(IOException expected){}
   server.enqueue(new MockResponse().setBody("0123456789"));try{HaDisplay.get(server.url("/").toString(),5);fail();}catch(IOException expected){}
   assertEquals(2,server.getRequestCount());
  }
 }
}
