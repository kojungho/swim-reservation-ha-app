package kr.swim.phone;
import android.app.*;import android.content.*;import android.content.pm.ServiceInfo;import android.os.*;import java.util.*;
/** Shared foreground lifetime; every schedule has a separate task and WebView profile. */
public final class ReservationService extends Service {
    static final String CHANNEL="reservation-execution",RESULT_CHANNEL="reservation-results";
    private static volatile ReservationService instance;
    final Map<Integer,ReservationTask> tasks=new java.util.concurrent.ConcurrentHashMap<>();volatile boolean closing=false;boolean dispatching=false;
    static boolean alive(){return alive(0);}
    static boolean alive(int slot){return instance!=null&&!instance.closing&&instance.tasks.containsKey(slot);}
    @Override public void onCreate(){super.onCreate();instance=this;channel(this);}
    static void channel(Context c){NotificationManager m=c.getSystemService(NotificationManager.class);m.createNotificationChannel(new NotificationChannel(CHANNEL,"예약 엔진 실행 상태",NotificationManager.IMPORTANCE_LOW));m.createNotificationChannel(new NotificationChannel(RESULT_CHANNEL,"예약 결과·오류 알림",NotificationManager.IMPORTANCE_DEFAULT));}
    static Notification notice(Context c,String text,boolean ongoing){return notice(c,text,ongoing,RunContext.slot(c));}
    static Notification notice(Context c,String text,boolean ongoing,int slot){
        PendingIntent open=PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b=new Notification.Builder(c,ongoing?CHANNEL:RESULT_CHANNEL).setSmallIcon(R.drawable.ic_camp).setContentTitle(notificationTitle(c,slot)).setVisibility(Notification.VISIBILITY_PRIVATE).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(open).setOngoing(ongoing).setOnlyAlertOnce(true);
        b.addAction(new Notification.Action.Builder(null,"예약 내역 조회",lookupIntent(c)).build());
        if(ongoing)b.addAction(new Notification.Action.Builder(null,slot<0?"전체 중지":"이 작업 중지",PendingIntent.getService(c,100+slot,new Intent(c,ReservationService.class).setAction("STOP").putExtra("slot",slot),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT)).build());return b.build();
    }
    static PendingIntent lookupIntent(Context c){return PendingIntent.getActivity(c,500,new Intent(c,MainActivity.class).setAction("kr.swim.phone.OPEN_LOOKUP").addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);}
    static String notificationTitle(Context c,int slot){
        if(slot<0)return "예약 실행 중";
        LocalStore s=new LocalStore(c,slot);boolean demo=false;try{demo=s.load("run").demo();}catch(Exception ignored){}
        return ResultStatus.title(s.stage(),demo);
    }
    static void lookupResult(Context c,org.json.JSONArray rows,int failures){
        channel(c);String text=ResultStatus.lookupMessage(rows,failures);
        Notification n=new Notification.Builder(c,RESULT_CHANNEL).setSmallIcon(R.drawable.ic_camp).setVisibility(Notification.VISIBILITY_PRIVATE).setContentTitle(failures>0?"예약 조회 · 확인 필요":"예약 조회 완료").setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(lookupIntent(c)).setAutoCancel(true).setOnlyAlertOnce(true).build();
        c.getSystemService(NotificationManager.class).notify(200,n);
    }
    void foreground(){Notification n=notice(this,"예약·조회 "+tasks.size()+"건 실행 중",true,-1);if(Build.VERSION.SDK_INT>=34)startForeground(1,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(1,n);}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        String action=intent==null?"RECOVER":intent.getAction();int slot=intent==null?0:intent.getIntExtra("slot",0);
        if("STOP".equals(action)){if(slot<0){for(ReservationTask t:new ArrayList<>(tasks.values()))t.stop();PlanScheduler.stop(this);}else {ReservationTask task=tasks.get(slot);if(task!=null)task.stop();else PlanScheduler.stopSlot(this,slot);}return START_NOT_STICKY;}
        dispatching=true;foreground();
        if("RECOVER".equals(action)){for(int n=0;n<=PhoneRuns.LIMIT;n++)if(new LocalStore(this,n).active())startTask(n,false,false);}
        else if(slot>=0&&slot<=PhoneRuns.LIMIT){ReservationTask task=tasks.get(slot);if(task!=null){if("WAKE".equals(action))task.wake();}else startTask(slot,"RUN".equals(action),intent.getBooleanExtra("lookup",false));}
        dispatching=false;if(tasks.isEmpty()){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;}foreground();return START_STICKY;
    }
    void startTask(int slot,boolean fresh,boolean lookup){ReservationTask task=new ReservationTask(this,slot);tasks.put(slot,task);task.begin(fresh,lookup);}
    void taskDone(int slot){tasks.remove(slot);if(dispatching)return;if(tasks.isEmpty()){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}else foreground();}
    @Override public void onDestroy(){closing=true;for(ReservationTask task:new ArrayList<>(tasks.values()))task.destroy();tasks.clear();if(instance==this)instance=null;super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onTimeout(int startId,int type){for(ReservationTask task:new ArrayList<>(tasks.values()))task.stop();}
}
