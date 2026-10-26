package kr.swim.phone;
import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.*;import android.content.Context;import org.json.*;import javax.crypto.spec.SecretKeySpec;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28) @LooperMode(LooperMode.Mode.PAUSED)
public class LookupRulesTest {
 Context c;
 @Before public void setup(){c=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");PhoneSessions.testSupported=false;for(int n=0;n<=5;n++)c.getSharedPreferences(n==0?"phone-private":"phone-run-"+n,0).edit().clear().commit();PhoneReads.testMode=true;}
 @After public void cleanup(){CampLookup.cancel();PhoneSessions.testSupported=null;LocalStore.testKey=null;PhoneReads.testMode=false;}
 @Test public void absentPublicNumberAcceptsVerifiedDetailIdButNeverEmptyOrWrongDetail()throws Exception{
  JSONObject detail=new JSONObject().put("id","TEST123-ABC");assertTrue(CampLookup.detailIdMatches(new JSONObject().put("id",JSONObject.NULL),detail));assertTrue(CampLookup.detailIdMatches(new JSONObject(),detail));assertTrue(CampLookup.detailIdMatches(new JSONObject().put("id","TEST123-ABC"),detail));assertFalse(CampLookup.detailIdMatches(new JSONObject().put("id","OTHER123-ABC"),detail));assertFalse(CampLookup.detailIdMatches(new JSONObject().put("id",JSONObject.NULL),new JSONObject()));
 }
 @Test public void futureWaitingDoesNotBlockReadOnlyLookupOrLoseItsAlarmState()throws Exception{
  LocalStore store=new LocalStore(c);Plan plan=Plan.sample();plan.trigger=System.currentTimeMillis()+3600000;store.save("run",plan);store.state("WAITING","미래 예약 대기",true);
  CampLookup.begin(c,new JSONArray().put(new JSONObject().put("name","모의예약자").put("phone","01000000000")));assertNotNull(CampLookup.active);assertTrue(store.active());assertEquals("WAITING",store.stage());CampLookup.cancel();assertTrue(store.active());assertEquals(plan.trigger,store.load("run").trigger);
 }
 @Test public void sharedProfileCannotStartLookupDuringActualBooking()throws Exception{
  new LocalStore(c).state("PREPARING","모의 예약 실행",true);try{CampLookup.begin(c,new JSONArray().put(new JSONObject().put("name","모의예약자").put("phone","01000000000")));fail("shared cookie lookup started during booking");}catch(IllegalStateException e){assertTrue(e.getMessage().contains("예약 실행"));}assertNull(CampLookup.active);
 }
 @Test public void invalidProfileFailsBeforeCreatingAnyLookup()throws Exception{
  try{CampLookup.begin(c,new JSONArray().put(new JSONObject().put("name"," ").put("phone","bad")));fail("invalid identity accepted");}catch(IllegalArgumentException e){assertTrue(e.getMessage().contains("예약자명"));}assertNull(CampLookup.active);
 }
}
