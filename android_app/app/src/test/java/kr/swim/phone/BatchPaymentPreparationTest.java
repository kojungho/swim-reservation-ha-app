package kr.swim.phone;
import android.content.Context;import org.json.*;import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.Config;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class BatchPaymentPreparationTest {
 final PhoneEngine.Events noExecution=new PhoneEngine.Events(){public void stage(String s,String m){fail("unexpected execution");}public void beforeFinal(){fail("no final submission");}public void finished(String s,String m){fail("unexpected execution");}};
 @Test public void multipleRoomsKeepSelectedGuestInSeparateBankFormTasks()throws Exception{
  Context c=RuntimeEnvironment.getApplication();Plan p=Plan.sample();p.mode="multiple";p.name="점검예약자";p.phone="01000000000";p.payer="";p.rooms="해_하늘존, 달_하늘존";
  BatchPhoneEngine batch=new BatchPhoneEngine(c,p,noExecution);assertEquals(2,batch.tasks.size());
  for(int i=0;i<2;i++){Plan task=batch.tasks.get(i);assertEquals("reserve",task.mode);assertEquals(p.name,task.name);assertEquals(p.phone,task.phone);assertEquals("",task.payer);assertEquals(0,task.people.length());assertEquals(1,task.priorities().size());assertEquals(p.priorities().get(i),task.rooms);}
 }
 @Test public void profilesUseOwnIdentityAndSitePreferencesNotLegacyRootGuest()throws Exception{
  Context c=RuntimeEnvironment.getApplication();Plan p=Plan.sample();p.mode="profiles-parallel";p.name="이전예약자";p.phone="01000000009";
  p.people=new JSONArray().put(new JSONObject().put("name","점검예약자").put("phone","01000000000").put("rooms","해_하늘존")).put(new JSONObject().put("name","확인예약자").put("phone","01000000001").put("payer","다른입금자").put("rooms","달_하늘존"));
  BatchPhoneEngine batch=new BatchPhoneEngine(c,p,noExecution);assertEquals(2,batch.tasks.size());
  assertEquals("점검예약자",batch.tasks.get(0).name);assertEquals("01000000000",batch.tasks.get(0).phone);assertEquals("해_하늘존",batch.tasks.get(0).rooms);assertEquals("",batch.tasks.get(0).payer);
  assertEquals("확인예약자",batch.tasks.get(1).name);assertEquals("01000000001",batch.tasks.get(1).phone);assertEquals("달_하늘존",batch.tasks.get(1).rooms);assertEquals("다른입금자",batch.tasks.get(1).payer);
 }
}
