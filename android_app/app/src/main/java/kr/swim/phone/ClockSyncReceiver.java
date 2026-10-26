package kr.swim.phone;
import android.app.*;import android.content.*;import android.os.*;import java.util.concurrent.*;
/** One bounded, silent HEAD time sync one hour before each waiting reservation. No booking launch. */
public final class ClockSyncReceiver extends BroadcastReceiver {
 static final ExecutorService worker=Executors.newSingleThreadExecutor();static final long HOUR=3600000L;
 static PendingIntent pending(Context c,int slot){return PendingIntent.getBroadcast(c,700+slot,new Intent(c,ClockSyncReceiver.class).setAction("CLOCK_SYNC").putExtra("slot",slot),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 static long completed(Context c,int slot){return c.getSharedPreferences("clock-sync-markers",0).getLong("slot-"+slot,0);}
 static void arm(Context c,long trigger,int slot){
  if(trigger<=SiteClock.now(c)||completed(c,slot)==trigger)return;
  long due=trigger-HOUR;
  if(due<=SiteClock.now(c)){worker.execute(()->synchronize(c,slot));return;}
  if(!AlarmReceiver.permitted(c))return;
  c.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,due-SiteClock.offset(c),pending(c,slot));
 }
 static void cancel(Context c,int slot){c.getSystemService(AlarmManager.class).cancel(pending(c,slot));}
 static void synchronize(Context c,int slot){
  LocalStore store=new LocalStore(c,slot);
  try{
   Plan plan=store.load("run");if(!store.active()||!store.stage().equals("WAITING")||plan.trigger<=SiteClock.now(c)||completed(c,slot)==plan.trigger)return;
   if(PhoneRuns.executing(c)){armRetry(c,slot,plan.trigger);return;}
   long updated=c.getSharedPreferences("site-clock",0).getLong("updated",0);
   if(System.currentTimeMillis()-updated>30000)PhoneReads.syncTimeNow(c);
   if(!store.active()||!store.stage().equals("WAITING"))return;
   c.getSharedPreferences("clock-sync-markers",0).edit().putLong("slot-"+slot,plan.trigger).commit();
   PhoneRuns.reschedule(c);
  }catch(Exception e){try{long trigger=store.load("run").trigger;armRetry(c,slot,trigger);}catch(Exception ignored){}}
 }
 static void armRetry(Context c,int slot,long trigger){if(!AlarmReceiver.permitted(c)||trigger-SiteClock.now(c)<600000)return;c.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,System.currentTimeMillis()+300000,pending(c,slot));}
 @Override public void onReceive(Context c,Intent intent){
  if(intent==null||!"CLOCK_SYNC".equals(intent.getAction()))return;int slot=intent.getIntExtra("slot",-1);if(slot<0||slot>PhoneRuns.LIMIT)return;
  LocalStore store=new LocalStore(c,slot);try{Plan plan=store.load("run");if(!store.active()||!store.stage().equals("WAITING"))return;if(plan.trigger-HOUR>SiteClock.now(c)){arm(c,plan.trigger,slot);return;}}catch(Exception e){return;}
  PendingResult result=goAsync();PowerManager.WakeLock wake=c.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"SwimPhone:TimeSync");wake.acquire(30000);
  worker.execute(()->{try{synchronize(c,slot);}finally{if(wake.isHeld())wake.release();result.finish();}});
 }
}
