package kr.swim.phone;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;

/** Active execution/watch only. Future schedules have no service or ongoing notification. */
public final class ReservationService extends Service {
    static final String CHANNEL="reservation-execution";
    private static ReservationService instance;
    static boolean alive(){return instance!=null&&!instance.closing;}
    private final Handler main=new Handler(Looper.getMainLooper());
    private LocalStore store;private Plan plan;private PhoneEngine engine;
    private PowerManager.WakeLock wake;
    private boolean running=false,closing=false,lookup=false;
    private final Runnable renew=new Runnable(){public void run(){if(!running||engine==null)return;holdCpu();main.postDelayed(this,60000);}};
    private final Runnable watchDue=()->{if(running&&plan!=null&&plan.watch()&&store.active())execute();};
    @Override public void onCreate(){super.onCreate();instance=this;store=new LocalStore(this);channel(this);}
    static void channel(Context c){c.getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"예약 엔진 실행 상태",NotificationManager.IMPORTANCE_LOW));}
    static Notification notice(Context c,String text,boolean ongoing){
        PendingIntent open=PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b=new Notification.Builder(c,CHANNEL).setSmallIcon(kr.swim.phone.R.drawable.ic_camp).setContentTitle("쉼오지 폰 예약")
            .setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(open).setOngoing(ongoing).setOnlyAlertOnce(true);
        if(ongoing)b.addAction(new Notification.Action.Builder(null,"중지",PendingIntent.getService(c,1,new Intent(c,ReservationService.class).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT)).build());
        return b.build();
    }
    private void foreground(String text){
        if(Build.VERSION.SDK_INT>=34)startForeground(1,notice(this,text,true),ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1,notice(this,text,true));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        String action=intent==null?"RECOVER":intent.getAction();
        if("STOP".equals(action)){
            if(engine!=null)engine.cancel();else finish(store.uncertain()?"CHECK_REQUIRED":"STOPPED","사용자가 중지했습니다. 미확인 제출은 내역을 먼저 확인하세요.");
            return START_NOT_STICKY;
        }
        if(running){
            if("WAKE".equals(action)&&store.stage().equals("WATCHING"))execute();
            return START_STICKY;
        }
        try {
            foreground("폰 내부 예약 엔진을 준비합니다.");
            if(!store.active()){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;}
            boolean newlyStarted="RUN".equals(action);
            if(!newlyStarted&&!"RECOVER".equals(action)&&!"WAKE".equals(action))throw new IllegalStateException("지원하지 않는 실행 요청입니다.");
            String stage=store.stage();
            if(newlyStarted?!stage.equals("STARTING"):!stage.equals("WAITING")&&!stage.equals("WATCHING"))
                throw new IllegalStateException("처리 중 앱이 종료됐습니다. 예약 내역 확인 전 재전송하지 않습니다.");
            plan=store.load("run");lookup=newlyStarted&&intent.getBooleanExtra("lookup",false);
            plan.validate(lookup);PlanScheduler.requireReady(this,plan,lookup);
            if(!lookup&&!plan.demo()&&store.uncertain())throw new IllegalStateException("이전 최종 제출 결과가 미확인입니다. 공식 내역을 먼저 확인하세요.");
            running=true;
            if(stage.equals("WAITING")&&plan.trigger>System.currentTimeMillis()){
                AlarmReceiver.schedule(this,plan.trigger);
                running=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY;
            }
            execute();
        }catch(Exception e){finish(store.uncertain()?"CHECK_REQUIRED":"FAILED",e instanceof IllegalStateException||e instanceof IllegalArgumentException?e.getMessage():"폰 내부 저장·실행 초기화 실패. 앱에서 확인하세요.");}
        return running&&!lookup?START_STICKY:START_NOT_STICKY;
    }
    private void execute(){
        if(!running||engine!=null)return;
        if(!store.active()){finish(store.uncertain()?"CHECK_REQUIRED":"STOPPED","등록된 실행 일정이 없어 중지했습니다.");return;}
        long now=System.currentTimeMillis();
        if(!lookup&&now>=plan.stayStart()){finish("STOPPED","입실일 00시가 지나 실행하지 않습니다.");return;}
        try {PlanScheduler.requireReady(this,plan,lookup);}
        catch(Exception e){finish("FAILED",e.getMessage());return;}
        if(!lookup&&plan.watch()&&store.stage().equals("WATCHING")){
            long remaining=store.watchDueElapsed()-SystemClock.elapsedRealtime();
            if(remaining>0){
                try{AlarmReceiver.scheduleWatch(this,store.watchDueElapsed());main.removeCallbacks(watchDue);main.postDelayed(watchDue,remaining);}
                catch(Exception e){finish("FAILED","감시 알람 예약 실패 · 권한을 확인해 주세요.");}
                return;
            }
        }
        if(!lookup&&!plan.watch()&&plan.trigger>0&&now-plan.trigger>10000){finish("FAILED","예약 시각보다 10초 이상 늦게 깨어나 자동 제출하지 않았습니다.");return;}
        main.removeCallbacks(watchDue);AlarmReceiver.cancel(this);
        holdCpu();main.removeCallbacks(renew);main.postDelayed(renew,60000);
        try {
            engine=new PhoneEngine(this,plan,lookup,new PhoneEngine.Events(){
                @Override public void stage(String stage,String message){update(stage,message);}
                @Override public void beforeFinal(){
                    if(!running||closing||!store.active()||System.currentTimeMillis()>=plan.stayStart())throw new IllegalStateException("Stopped or expired");
                    if(!plan.demo()){if(store.uncertain())throw new IllegalStateException("Uncertain prior submit");store.markSubmitted();}
                    store.state("SUBMITTING",plan.demo()?"[모의] 최종 제출 기록":"최종 제출 전 기록 완료 · 중복 제출 방지",true);
                }
                @Override public void finished(String stage,String message){
                    engine=null;if(!running||closing)return;
                    if(stage.equals("NO_ROOM")&&plan.watch()&&!lookup)parkWatch();
                    else {if(stage.equals("SUCCESS")&&!plan.demo()){store.completed();try{new PhoneRepository(ReservationService.this).completeDraft(plan);}catch(Exception ignored){/* A draft failure must not turn a confirmed booking into a retry. */}}finish(stage,message);}
                }
            });
            engine.start();
        }catch(Exception e){finish(store.uncertain()?"CHECK_REQUIRED":"FAILED","예약 엔진 시작 실패 · 자동 재시도 없음");}
    }
    private void parkWatch(){
        releaseCpu();
        try {
            long delay=Math.max(Plan.MIN_POLL_SECONDS,plan.pollSeconds)*1000L;
            long untilMidnight=plan.stayStart()-System.currentTimeMillis();
            if(untilMidnight<=0){finish("STOPPED","입실일 00시가 지나 감시를 종료했습니다.");return;}
            // A deadline alarm may wake earlier solely to terminate, never to query before ten minutes.
            long due=SystemClock.elapsedRealtime()+Math.min(delay,untilMidnight);
            store.watchDueElapsed(due);
            update("WATCHING","빈 객실 없음 · "+plan.pollSeconds/60+"분 이상 간격 · 조회 사이 CPU 절전 · 입실일 00시 종료");
            AlarmReceiver.scheduleWatch(this,due);
            main.removeCallbacks(watchDue);main.postDelayed(watchDue,Math.min(delay,untilMidnight));
        }catch(Exception e){finish("FAILED","감시 시각 저장·알람 예약 실패 · 안전 중지");}
    }
    private void holdCpu(){
        if(wake==null){wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"SwimPhone:ReservationEngine");wake.setReferenceCounted(false);}
        wake.acquire(120000);
    }
    private void releaseCpu(){main.removeCallbacks(renew);if(wake!=null&&wake.isHeld())wake.release();}
    private void update(String stage,String message){store.state(stage,message,true);getSystemService(NotificationManager.class).notify(1,notice(this,message,true));}
    private void finish(String stage,String message){
        if(closing)return;closing=true;running=false;main.removeCallbacksAndMessages(null);AlarmReceiver.cancel(this);
        if(engine!=null){PhoneEngine old=engine;engine=null;old.cancel();}
        releaseCpu();store.watchDueElapsed(0);
        store.state(stage,message==null?"작업 중지":message,false);stopForeground(STOP_FOREGROUND_REMOVE);
        getSystemService(NotificationManager.class).notify(2,notice(this,store.message(),false));stopSelf();
    }
    @Override public void onDestroy(){
        main.removeCallbacksAndMessages(null);
        if(engine!=null){closing=true;engine.cancel();engine=null;}
        releaseCpu();if(instance==this)instance=null;super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onTimeout(int startId,int foregroundServiceType){finish(store.uncertain()?"CHECK_REQUIRED":"STOPPED","안드로이드 실행 시간 제한으로 중지했습니다. 앱에서 확인하세요.");}
}
