package kr.swim.phone;
import android.content.Context;import javax.crypto.spec.SecretKeySpec;import org.json.*;import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.Config;import okhttp3.mockwebserver.*;import java.util.concurrent.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class AppProblemsTest {
 Context c;
 @Before public void setup(){c=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");c.getSharedPreferences("phone-private",0).edit().clear().commit();AppProblems.testPaused=true;}
 @After public void cleanup(){LocalStore.testKey=null;AppProblems.testPaused=false;}
 @Test public void queueIsEncryptedMinimalAndIndependentOfReservation()throws Exception{
  AppProblems.enqueue(c,"preflight","failed","PAYMENT_METHOD_UNRECOGNIZED","prepare");JSONObject event=AppProblems.first(c);assertEquals(9,event.length());assertEquals("PAYMENT_METHOD_UNRECOGNIZED",event.getString("code"));assertFalse(event.has("phone"));assertFalse(new LocalStore(c).active());assertFalse(new LocalStore(c).uncertain());
  String id=event.getString("id"),client=event.getString("clientId");assertFalse(c.getSharedPreferences("phone-private",0).getString("app-problems","").contains("PAYMENT_METHOD"));
  AppProblems.enqueue(c,"preflight","failed","RAW_01012345678","SECRET_NAME");JSONObject second=AppProblems.load(c).getJSONArray("pending").getJSONObject(1);assertEquals(client,second.getString("clientId"));assertEquals("CHECK_FAILED",second.getString("code"));assertEquals("unknown",second.getString("stage"));assertFalse(second.toString().contains("SECRET"));
  AppProblems.acknowledged(c,id);assertEquals(1,AppProblems.load(c).getJSONArray("pending").length());assertEquals(0,new BookingRecords(c).list().length());
 }
 @Test public void postContainsOnlyEventAndNoAuthAndRequiresMatchingAck()throws Exception{
  AppProblems.enqueue(c,"preflight","failed","FORM_MISMATCH","prepare");JSONObject event=AppProblems.first(c);try(MockWebServer server=new MockWebServer()){server.start();server.enqueue(new MockResponse().setBody(new JSONObject().put("ok",true).put("id",event.getString("id")).toString()));AppProblems.send(event,server.url("").toString().replaceAll("/$",""));RecordedRequest request=server.takeRequest(2,TimeUnit.SECONDS);assertNotNull(request);assertEquals("POST",request.getMethod());assertEquals("/api/swim_phone/problem",request.getPath());assertNull(request.getHeader("Authorization"));assertNull(request.getHeader("Cookie"));assertEquals(event.toString(),request.getBody().readUtf8());
   server.enqueue(new MockResponse().setBody("{\"ok\":true,\"id\":\"wrong\"}"));try{AppProblems.send(event,server.url("").toString().replaceAll("/$",""));fail();}catch(java.io.IOException expected){}assertEquals(event.getString("id"),AppProblems.first(c).getString("id"));
  }
 }
}
