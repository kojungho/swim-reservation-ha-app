package kr.swim.phone;
import android.content.Context;import javax.crypto.spec.SecretKeySpec;import org.json.*;import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.Config;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class BookingRecordsTest {
 Context context;
 @Before public void setup(){context=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");context.getSharedPreferences("phone-private",0).edit().clear().commit();}
 @After public void cleanup(){LocalStore.testKey=null;}
 @Test public void encryptedIndependentSnapshotCanBeCompletedAndDeleted()throws Exception{
  Plan plan=Plan.sample();BookingRecords records=new BookingRecords(context);JSONObject entered=new JSONObject().put("name","모의예약자").put("phone","01012345678").put("request"," 원문 유지 ").put("fields",new JSONArray().put(new JSONObject().put("role","phone").put("name","contact_v2").put("value","010-1234-5678"))).put("_csrf","NEVER-SAVE");String id=records.begin(plan,"해_하늘존",entered);entered.put("phone","01099999999");
  JSONObject saved=records.list().getJSONObject(0);assertEquals("01012345678",saved.getJSONObject("entered").getString("phone"));assertEquals(" 원문 유지 ",saved.getJSONObject("entered").getString("request"));assertEquals("check_required",saved.getString("state"));assertFalse(saved.toString().contains("NEVER-SAVE"));assertFalse(context.getSharedPreferences("phone-private",0).getString("booking-records","").contains("모의예약자"));
  records.complete(id,new JSONObject().put("id","FAKE123").put("total","60,000원").put("status","입금 대기"));assertEquals("complete",records.list().getJSONObject(0).getString("state"));assertEquals(1,records.list().length());assertFalse(new LocalStore(context).active());records.delete(id);records.complete(id,new JSONObject());assertEquals(0,records.list().length());
 }
}
