package kr.swim.phone;
import android.app.*;import android.content.*;import org.json.*;import java.security.*;import java.nio.charset.StandardCharsets;
/** Separate exact alarm. Restoring it never changes the real run or submit marker. */
public final class PreflightReceiver extends BroadcastReceiver {
 static PendingIntent pending(Context c,int slot){return PendingIntent.getBroadcast(c,900+slot,new Intent(c,PreflightReceiver.class).setAction("PREFLIGHT").putExtra("slot",slot),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
 static String key(Context c,int slot)throws Exception{JSONObject run=new LocalStore(c,slot).loadDocument("run");if(run==null)throw new IllegalStateException();byte[] digest=MessageDigest.getInstance("SHA-256").digest(run.toString().getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
 static boolean eligible(Context c,int slot)throws Exception{LocalStore s=new LocalStore(c,slot);Plan p=s.load("run");JSONObject run=s.loadDocument("run");return run!=null&&!run.optBoolean("_lookup")&&s.active()&&s.stage().equals("WAITING")&&!p.watch()&&!p.demo()&&p.siteVersion.equals("swimozicamp-v1")&&p.trigger>SiteClock.now(c);}
 static void arm(Context c,int slot){try{
  if(!eligible(c,slot)||!AlarmReceiver.permitted(c))return;
  JSONObject record=new LocalStore(c,slot).loadDocument("preflight-check");String key=key(c,slot);
  if(record!=null&&key.equals(record.optString("key"))&&!record.optString("state").equals("checking"))return;
  if(PreflightService.alive(slot))return;
  long now=SiteClock.now(c),due=PreflightPolicy.next(new LocalStore(c,slot).load("run").trigger,now);if(due==0)return;
  c.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,due-SiteClock.offset(c),pending(c,slot));
 }catch(Exception ignored){/* Must never cancel a reservation because a check cannot be armed. */}}
 static void retry(Context c,int slot){try{long now=SiteClock.now(c);Plan p=new LocalStore(c,slot).load("run");long due=PreflightPolicy.next(p.trigger,now+180000);if(due>0&&eligible(c,slot)&&AlarmReceiver.permitted(c))c.getSystemService(AlarmManager.class).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,due-SiteClock.offset(c),pending(c,slot));}catch(Exception ignored){}}
 static void cancel(Context c,int slot){c.getSystemService(AlarmManager.class).cancel(pending(c,slot));PreflightService.cancelSlot(slot);}
 @Override public void onReceive(Context c,Intent intent){if(intent==null||!"PREFLIGHT".equals(intent.getAction()))return;int slot=intent.getIntExtra("slot",-1);if(slot<0||slot>PhoneRuns.LIMIT)return;
  try{if(!eligible(c,slot))return;Plan p=new LocalStore(c,slot).load("run");long now=SiteClock.now(c);if(!PreflightPolicy.daytime(now)||now<PreflightPolicy.due(p.trigger)){arm(c,slot);return;}if(p.trigger-now<=300000)return;
   c.startForegroundService(new Intent(c,PreflightService.class).setAction("CHECK").putExtra("slot",slot));
  }catch(Exception e){try{PreflightService.result(c,slot,key(c,slot),"failed","BACKGROUND_START","");}catch(Exception ignored){}}
 }
}
