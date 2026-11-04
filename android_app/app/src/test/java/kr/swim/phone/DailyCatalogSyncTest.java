package kr.swim.phone;
import android.content.Context;import javax.crypto.spec.SecretKeySpec;import org.json.*;import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.Config;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class DailyCatalogSyncTest {
 Context c;JSONArray original;
 @Before public void setup(){c=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");c.getSharedPreferences("phone-private",0).edit().clear().commit();original=RoomCatalog.entries();}
 @After public void cleanup()throws Exception{RoomCatalog.merge(c,original,false,true);c.getSharedPreferences("phone-private",0).edit().clear().commit();LocalStore.testKey=null;}
 JSONObject source(long at)throws Exception{return new JSONObject().put("checkedAt",at).put("entries",new JSONArray().put(new JSONObject().put("name","해_하늘존").put("displayName","하늘존해").put("siteId",11).put("phone","PRIVATE")).put(new JSONObject().put("name","새사이트_산맥존").put("displayName","산맥존새사이트").put("siteId",15))).put("profiles","PRIVATE");}
 @Test public void serverDailySnapshotAppliesAheadOfBookingWithoutChangingPlans()throws Exception{
  LocalStore vault=new LocalStore(c,0);vault.saveDocument("phone-ui-v1",new JSONObject().put("draft","KEEP"));long at=System.currentTimeMillis()+10000;assertTrue(RoomCatalog.applyServer(c,source(at)));assertEquals(11,RoomCatalog.id("해_하늘존"));assertEquals(15,RoomCatalog.id("새사이트_산맥존"));assertEquals("KEEP",vault.loadDocument("phone-ui-v1").getString("draft"));assertFalse(vault.loadDocument("catalog-v1").toString().contains("PRIVATE"));RoomCatalog.restore(c);assertEquals(11,RoomCatalog.id("해_하늘존"));assertFalse(RoomCatalog.applyServer(c,source(at-1)));
 }
 @Test public void runningReservationAndNewerLocalLookupAreNotOverwritten()throws Exception{
  long at=System.currentTimeMillis()+10000;LocalStore running=new LocalStore(c,1);running.state("PREPARING","mock",true);assertFalse(RoomCatalog.applyServer(c,source(at)));running.state("STOPPED","mock",false);RoomCatalog.merge(c,original,true);assertFalse(RoomCatalog.applyServer(c,source(1)));
 }
 @Test public void malformedOrAmbiguousPublicCatalogIsRejected()throws Exception{
  for(Object bad:new Object[]{1.5,4294967297L,10001,"1",true}){JSONObject s=source(1800000000000L);s.getJSONArray("entries").getJSONObject(0).put("siteId",bad);try{RoomCatalog.projectSnapshot(s);fail("bad id");}catch(IllegalArgumentException expected){}}
  JSONObject duplicate=source(1800000000000L);duplicate.getJSONArray("entries").getJSONObject(1).put("siteId",11);try{RoomCatalog.projectSnapshot(duplicate);fail("duplicate");}catch(IllegalArgumentException expected){}
 }
}
