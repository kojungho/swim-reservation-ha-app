package kr.swim.phone;
import org.junit.*;import static org.junit.Assert.*;
import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.*;
import android.app.*;import android.content.*;import javax.crypto.spec.SecretKeySpec;import org.json.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28) @LooperMode(LooperMode.Mode.PAUSED)
public class ResultStatusTest {
 Context c;
 @Before public void setup(){c=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");for(int n=0;n<=5;n++)c.getSharedPreferences(n==0?"phone-private":"phone-run-"+n,0).edit().clear().commit();ReservationService.channel(c);}
 @After public void cleanup(){LocalStore.testKey=null;}
 @Test public void emptyBatchCannotReportSuccessOrPayment()throws Exception{
  Plan p=new Plan();p.mode="profiles-parallel";
  final String[] result=new String[2];BatchPhoneEngine engine=new BatchPhoneEngine(c,p,new PhoneEngine.Events(){public void stage(String s,String m){}public void beforeFinal(){}public void finished(String s,String m){result[0]=s;result[1]=m;}});
  engine.start();assertEquals("FAILED",result[0]);assertFalse(result[1].contains("입금"));assertFalse(result[1].contains("완료"));
 }
 @Test public void noRoomsPartialAndSuccessUseVerifiedReceiptCounts(){
  assertEquals("NO_ROOM",ResultStatus.batchStage(0,3));assertFalse(ResultStatus.batchMessage(0,3).contains("입금"));
  assertEquals("PARTIAL",ResultStatus.batchStage(1,3));assertTrue(ResultStatus.batchMessage(1,3).contains("확인된 1건은 신청 당시 입금 대기"));
  assertEquals("SUCCESS",ResultStatus.batchStage(3,3));assertTrue(ResultStatus.batchMessage(3,3).contains("현재 입금·취소 상태"));
 }
 @Test public void lookupCountsDistinguishConfirmedClosedPendingAndFailures()throws Exception{
  JSONArray rows=new JSONArray().put(new JSONObject().put("paymentStatus","pending")).put(new JSONObject().put("paymentStatus","confirmed")).put(new JSONObject().put("paymentStatus","closed"));
  String text=ResultStatus.lookupMessage(rows,1);for(String part:new String[]{"입금 대기 1건","예약 확정 1건","취소·만료 1건","조회 실패 1명","누락될 수"})assertTrue(text,text.contains(part));
  assertFalse(ResultStatus.lookupMessage(new JSONArray(),0).contains("입금 대기"));
  assertTrue(ResultStatus.lookupMessage(new JSONArray(),1).contains("예약 유무를 확인하지 못했습니다"));assertFalse(ResultStatus.lookupMessage(new JSONArray(),1).contains("내역이 없습니다"));
 }
 @Test public void noticeTitlesFollowStateAndDemoIsExplicit()throws Exception{
  LocalStore s=new LocalStore(c,1);s.save("run",Plan.sample());s.state("SUCCESS","모의 영수증",false);
  Notification demo=ReservationService.notice(c,"모의 영수증",false,1);assertEquals("[모의] 예약 신청 완료",demo.extras.getCharSequence(Notification.EXTRA_TITLE));
  s.state("WAITING","미래 시각",true);Notification waiting=ReservationService.notice(c,"미래 시각",true,1);assertTrue(waiting.extras.getCharSequence(Notification.EXTRA_TITLE).toString().contains("예약 대기"));assertEquals("예약 내역 조회",waiting.actions[0].title);assertEquals("이 작업 중지",waiting.actions[1].title);
  Intent target=Shadows.shadowOf(waiting.actions[0].actionIntent).getSavedIntent();assertEquals("kr.swim.phone.OPEN_LOOKUP",target.getAction());assertEquals(MainActivity.class.getName(),target.getComponent().getClassName());
 }
 @Test public void stoppingFuturePlanClearsWaitingNotification()throws Exception{
  LocalStore s=new LocalStore(c,1);s.save("run",Plan.sample());s.state("WAITING","예약 대기",true);
  NotificationManager m=c.getSystemService(NotificationManager.class);m.notify(11,ReservationService.notice(c,s.message(),true,1));PlanScheduler.stopSlot(c,1);
  assertNull(Shadows.shadowOf(m).getNotification(11));assertNotNull(Shadows.shadowOf(m).getNotification(21));assertEquals("STOPPED",s.stage());
 }
 @Test public void oldZeroOverZeroIsRepairedWithoutDeclaringNoReservationsOrRetrying()throws Exception{
  LocalStore s=new LocalStore(c,0);s.state("SUCCESS","다인·다중 결과: 완료 0 / 0 · 각 예약은 입금 대기입니다.",false);
  ResultStatus.repairLegacyResult(c,0);assertEquals("CHECK_REQUIRED",s.stage());assertFalse(s.active());assertTrue(s.message().contains("성공 증거가 아닙니다"));
  try{PhoneRuns.requireRestartable(new JSONObject().put("stage",s.stage()));fail("unverified legacy result restarted");}catch(IllegalStateException expected){}
  s.state("SUCCESS","예약 신청 완료 · 신청 당시 입금 대기",false);ResultStatus.repairLegacyResult(c,0);assertEquals("SUCCESS",s.stage());
 }
 @Test public void lookupNotificationDoesNotReplaceScheduleResult()throws Exception{
  NotificationManager m=c.getSystemService(NotificationManager.class);m.notify(21,ReservationService.notice(c,"예약 결과 확인 필요",false,1));
  ReservationService.lookupResult(c,new JSONArray(),1);assertNotNull(Shadows.shadowOf(m).getNotification(21));Notification n=Shadows.shadowOf(m).getNotification(200);assertEquals("예약 조회 · 확인 필요",n.extras.getCharSequence(Notification.EXTRA_TITLE));assertTrue(n.extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("예약 유무를 확인하지 못했습니다"));
 }
}
