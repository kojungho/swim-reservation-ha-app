package kr.swim.phone;
import android.app.*;import android.content.*;import android.content.pm.ServiceInfo;import android.os.*;import org.json.*;
/** Bounded read-only work; its foreground lifetime never owns a reservation task. */
public final class PreflightService extends Service {
 static final String CHANNEL="reservation-preflight";static volatile PreflightService instance;
 interface Result {void done(String state,String code,String step);}
 interface Factory {PhoneExecution create(Context c,Plan plan,Result result)throws Exception;}
 static Factory factory=PhonePreflightEngine::new;
 final Handler main=new Handler(Looper.getMainLooper());PhoneExecution engine;PowerManager.WakeLock wake;int slot=-1;String key="";boolean ended;
 final Runnable timeout=()->finish("failed","TIMEOUT","");
 static boolean alive(int slot){return instance!=null&&!instance.ended&&instance.slot==slot;}
 static void cancelSlot(int slot){PreflightService s=instance;if(s!=null&&s.slot==slot)s.finishQuietly();}
 static void cancelForExecution(){PreflightService s=instance;if(s!=null)s.finish("failed","BUSY","");}
 static void channel(Context c){c.getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"예약 사전 점검",NotificationManager.IMPORTANCE_DEFAULT));}
 static Notification notice(Context c,String title,String message,boolean ongoing){channel(c);PendingIntent open=PendingIntent.getActivity(c,850,new Intent(c,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);return new Notification.Builder(c,CHANNEL).setSmallIcon(R.drawable.ic_camp).setContentTitle(title).setContentText(message).setStyle(new Notification.BigTextStyle().bigText(message)).setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(open).setOngoing(ongoing).setOnlyAlertOnce(ongoing).build();}
 static String message(String state,String code,String step){
  String text=state.equals("passed")?"열린 날짜의 1박 빈자리로 예약자 입력·무통장입금·필수 약관 확인 완료. 실제 예약 접수 여부는 점검하지 않았습니다.":state.equals("unavailable")?"점검한 날짜에 빈자리가 없어 입력 단계까지 확인하지 못했습니다.":
   code.equals("PAYMENT_METHOD_UNRECOGNIZED")?"무통장입금 항목을 확인하지 못했습니다.":code.equals("FORM_FIELDS_UNRECOGNIZED")?"예약자 입력 또는 필수 약관을 확인하지 못했습니다.":code.startsWith("HTTP_")?"공식 사이트 HTTP 응답 오류 · "+code.substring(5):code.equals("INTERRUPTED")?"앱 종료·교체로 점검이 중단됐습니다.":code.equals("TIMEOUT")?"점검 제한 시간을 넘었습니다.":code.equals("BACKGROUND_START")?"백그라운드 점검을 시작하지 못했습니다. 앱 권한을 확인해 주세요.":"예약 양식 점검을 완료하지 못했습니다.";
  String label=step.equals("prepare")?"예약자·결제·약관 입력":step.equals("preflight")?"입력값 최종 대조":step.equals("listing")?"객실 조회":"";
  return (label.isEmpty()?"":label+": ")+text+" 최종 제출하지 않았으며 기존 예약 대기는 유지됩니다. 앱 실행 기록을 확인하세요.";
 }
 static synchronized void result(Context c,int slot,String key,String state,String code,String step)throws Exception{
  if(!key.equals(PreflightReceiver.key(c,slot)))return;
  LocalStore s=new LocalStore(c,slot);JSONObject old=s.loadDocument("preflight-check");if(old!=null&&key.equals(old.optString("key"))&&!old.optString("state").equals("checking"))return;
  s.saveDocument("preflight-check",new JSONObject().put("key",key).put("state",state).put("code",code).put("step",step).put("finishedAt",SiteClock.now(c)));
  if(!PreflightReceiver.eligible(c,slot))return;
  if(!state.equals("passed"))AppProblems.enqueue(c,"preflight",state,code,step);
  String title=state.equals("passed")?"예약 사전 점검 통과":state.equals("unavailable")?"예약 사전 점검 미완료":"예약 사전 점검 확인 필요";
  String message=message(state,code,step);s.appendLog(title+" · "+message);
  c.getSystemService(NotificationManager.class).notify(850+slot,notice(c,title,message,false));
 }
 @Override public void onCreate(){super.onCreate();instance=this;channel(this);}
 @Override public int onStartCommand(Intent intent,int flags,int startId){
  if(intent==null){stopSelf();return START_NOT_STICKY;}int requested=intent.getIntExtra("slot",-1);if(requested<0||requested>PhoneRuns.LIMIT){stopSelf();return START_NOT_STICKY;}
  if(engine!=null){if(requested!=slot)PreflightReceiver.retry(this,requested);return START_NOT_STICKY;}
  Notification n=notice(this,"예약 사전 점검 중","읽기·입력 검증만 진행 · 최종 제출 없음",true);if(Build.VERSION.SDK_INT>=34)startForeground(840,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(840,n);
  slot=requested;ended=false;
  try{
   if(!PreflightReceiver.eligible(this,slot)||!PreflightPolicy.daytime(SiteClock.now(this))){finishQuietly();PreflightReceiver.arm(this,slot);return START_NOT_STICKY;}
   Plan plan=new LocalStore(this,slot).load("run");long now=SiteClock.now(this);if(now<PreflightPolicy.due(plan.trigger)){finishQuietly();PreflightReceiver.arm(this,slot);return START_NOT_STICKY;}
   if(PhoneRuns.executing(this)||PhoneInspection.active!=null||CampLookup.active!=null||nearExecution(this,now)){PreflightReceiver.retry(this,slot);finishQuietly();return START_NOT_STICKY;}
   key=PreflightReceiver.key(this,slot);LocalStore s=new LocalStore(this,slot);JSONObject record=s.loadDocument("preflight-check");
   if(record!=null&&key.equals(record.optString("key"))){if(record.optString("state").equals("checking"))finish("failed","INTERRUPTED","");else finishQuietly();return START_NOT_STICKY;}
   s.saveDocument("preflight-check",new JSONObject().put("key",key).put("state","checking").put("startedAt",now));
   main.postDelayed(timeout,Math.max(1,Math.min(120000,PreflightPolicy.at(PreflightPolicy.day(now),19)-now)));
   wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"SwimPhone:Preflight");wake.acquire(125000);
   engine=factory.create(getApplicationContext(),plan,this::finish);engine.start();
  }catch(Exception e){finish("failed","CHECK_FAILED","");}return START_NOT_STICKY;
 }
 static boolean nearExecution(Context c,long now){for(int n=0;n<=PhoneRuns.LIMIT;n++){LocalStore s=new LocalStore(c,n);try{if(s.active()&&s.stage().equals("WAITING")){long trigger=s.load("run").trigger;if(trigger>0&&trigger-now<=300000)return true;}}catch(Exception ignored){}}return false;}
 void finish(String state,String code,String step){if(ended)return;try{result(this,slot,key,state,code,step);}catch(Exception ignored){}finishQuietly();}
 void finishQuietly(){if(ended)return;ended=true;main.removeCallbacksAndMessages(null);PhoneExecution work=engine;engine=null;if(work!=null)work.cancel();if(wake!=null&&wake.isHeld())wake.release();stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}
 @Override public void onDestroy(){if(!ended&&!key.isEmpty())finish("failed","INTERRUPTED","");else finishQuietly();if(instance==this)instance=null;super.onDestroy();}
 @Override public IBinder onBind(Intent intent){return null;}
 @Override public void onTimeout(int startId,int type){finish("failed","TIMEOUT","");}
}
