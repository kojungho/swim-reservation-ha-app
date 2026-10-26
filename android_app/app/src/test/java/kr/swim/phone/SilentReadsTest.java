package kr.swim.phone;
import org.junit.*;import static org.junit.Assert.*;import org.junit.runner.RunWith;import org.robolectric.*;import org.robolectric.annotation.*;
import android.app.*;import android.content.*;import javax.crypto.spec.SecretKeySpec;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28) @LooperMode(LooperMode.Mode.PAUSED)
public class SilentReadsTest {
 Context c;ReservationTask.Factory original;PhoneEngine.Events events;boolean canceled;
 @Before public void setup(){c=RuntimeEnvironment.getApplication();LocalStore.testKey=new SecretKeySpec(new byte[32],"AES");PhoneSessions.testSupported=true;for(int n=0;n<=6;n++)c.getSharedPreferences(n==0?"phone-private":"phone-run-"+n,0).edit().clear().commit();c.getSharedPreferences("clock-sync-markers",0).edit().clear().commit();c.getSharedPreferences("site-clock",0).edit().clear().commit();original=ReservationTask.factory;ReservationTask.factory=(context,plan,lookup,e)->{assertTrue(lookup);assertEquals(6,RunContext.slot(context));events=e;return new PhoneExecution(){public void start(){e.stage("INSPECTING","객실 읽기");}public void cancel(){canceled=true;e.finished("STOPPED","조회 중지");}};};}
 @After public void cleanup(){PhoneInspection.cancel();ReservationTask.factory=original;PhoneSessions.testSupported=null;LocalStore.testKey=null;}
 @Test public void inspectionNeverOverwritesReservationSlotOrPostsNotification()throws Exception{
  LocalStore booking=new LocalStore(c,0);booking.state("WAITING","기존 예약",true);
  PhoneInspection.start(c,Plan.sample());assertTrue(PhoneInspection.alive(6));assertEquals("WAITING",booking.stage());assertTrue(booking.active());
  assertEquals(0,Shadows.shadowOf(c.getSystemService(NotificationManager.class)).size());
  try{events.beforeFinal();fail("inspection submitted");}catch(IllegalStateException expected){}
  PhoneInspection.cancel();assertTrue(canceled);assertFalse(PhoneInspection.alive(6));assertEquals("WAITING",booking.stage());
 }
 @Test public void futureClockAlarmUsesServerOffsetAndCanBeCanceledSeparately(){
  c.getSharedPreferences("site-clock",0).edit().putLong("offset",1234).commit();
  long trigger=System.currentTimeMillis()+7200000;
  ClockSyncReceiver.arm(c,trigger,2);
  org.robolectric.shadows.ShadowAlarmManager alarms=Shadows.shadowOf(c.getSystemService(AlarmManager.class));
  assertEquals(trigger-3600000-1234,alarms.peekNextScheduledAlarm().triggerAtTime);
  assertEquals("CLOCK_SYNC",Shadows.shadowOf(alarms.peekNextScheduledAlarm().operation).getSavedIntent().getAction());
  ClockSyncReceiver.cancel(c,2);assertNull(alarms.peekNextScheduledAlarm());
 }
 @Test public void completedClockSyncDoesNotRearmForSameTrigger(){
  long trigger=System.currentTimeMillis()+7200000;
  c.getSharedPreferences("clock-sync-markers",0).edit().putLong("slot-2",trigger).commit();
  ClockSyncReceiver.arm(c,trigger,2);assertNull(Shadows.shadowOf(c.getSystemService(AlarmManager.class)).peekNextScheduledAlarm());
 }
}
