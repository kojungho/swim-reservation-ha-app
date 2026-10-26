package kr.swim.phone;
import android.app.*;import android.content.*;import android.os.*;
/** One schedule owns its engine, timers, wake lock, durable state and receipt marker. */
final class ReservationTask {
    interface Factory {PhoneExecution create(Context c,Plan p,boolean lookup,PhoneEngine.Events events)throws Exception;}
    static Factory factory=PhoneEngine::new; // Package-private instrumentation seam.
    final ReservationService owner;final Context context;final int slot;
    final Handler main=new Handler(Looper.getMainLooper());final LocalStore store;
    Plan plan;PhoneExecution engine;PowerManager.WakeLock wake;boolean running=false,closing=false,lookup=false;
    final Runnable renew=new Runnable(){public void run(){if(!running||engine==null)return;holdCpu();main.postDelayed(this,60000);}};
    final Runnable watchDue;
    ReservationTask(ReservationService owner,int slot){this.owner=owner;this.slot=slot;context=new RunContext(owner,slot);store=new LocalStore(context);watchDue=()->{if(running&&plan!=null&&plan.watch()&&store.active())execute();};}
    void begin(boolean newlyStarted,boolean lookup){
        try{
            if(!store.active()){owner.taskDone(slot);return;}
            String stage=store.stage();
            if(newlyStarted?!stage.equals("STARTING"):!stage.equals("WAITING")&&!stage.equals("WATCHING"))throw new IllegalStateException("처리 중 앱이 종료됐습니다. 내역 확인 전 재전송하지 않습니다.");
            plan=store.load("run");this.lookup=lookup;plan.validate(lookup);PlanScheduler.requireReady(context,plan,lookup);
            if(!lookup&&!plan.demo()&&store.uncertain())throw new IllegalStateException("이전 제출 결과를 먼저 확인하세요.");
            running=true;
            if(stage.equals("WAITING")&&plan.trigger>SiteClock.now(context)){AlarmReceiver.schedule(context,plan.trigger);running=false;owner.taskDone(slot);return;}
            execute();
        }catch(Exception e){finish(store.uncertain()?"CHECK_REQUIRED":"FAILED",e instanceof IllegalStateException||e instanceof IllegalArgumentException?e.getMessage():"폰 내부 실행 초기화 실패");}
    }
    void wake(){if(store.stage().equals("WATCHING"))execute();}
    void stop(){if(engine!=null)engine.cancel();else finish(store.uncertain()?"CHECK_REQUIRED":"STOPPED","사용자가 중지했습니다. 미확인 제출은 내역을 먼저 확인하세요.");}
    void destroy(){closing=true;main.removeCallbacksAndMessages(null);if(engine!=null){engine.cancel();engine=null;}releaseCpu();}
    private void execute(){
        if(!running||engine!=null)return;
        if(!store.active()){finish(store.uncertain()?"CHECK_REQUIRED":"STOPPED","등록된 실행 일정이 없어 중지했습니다.");return;}
        long now=SiteClock.now(context);
        if(!lookup&&now>=(plan.watch()?plan.deadline():plan.stayStart())){finish("STOPPED","예약·감시 마감 시각이 지나 실행하지 않습니다.");return;}
        try {PlanScheduler.requireReady(context,plan,lookup);}
        catch(Exception e){finish("FAILED",e.getMessage());return;}
        if(!lookup&&plan.watch()&&store.stage().equals("WATCHING")){
            long remaining=store.watchDueElapsed()-SystemClock.elapsedRealtime();
            if(remaining>0){
                try{AlarmReceiver.scheduleWatch(context,store.watchDueElapsed());main.removeCallbacks(watchDue);main.postDelayed(watchDue,remaining);}
                catch(Exception e){finish("FAILED","감시 알람 예약 실패 · 권한을 확인해 주세요.");}
                return;
            }
        }
        if(!lookup&&!plan.watch()&&plan.trigger>0&&now-plan.trigger>10000){finish("FAILED","예약 시각보다 10초 이상 늦게 깨어나 자동 제출하지 않았습니다.");return;}
        main.removeCallbacks(watchDue);AlarmReceiver.cancel(context);
        holdCpu();main.removeCallbacks(renew);main.postDelayed(renew,60000);
        try {
            if(!PhoneSessions.supported())CampLookup.cancel();
            engine=factory.create(context,plan,lookup,new PhoneEngine.Events(){
                @Override public void stage(String stage,String message){update(stage,message);}
                @Override public void beforeFinal(){
                    if(!running||closing||!store.active()||SiteClock.now(context)>=(plan.watch()?plan.deadline():plan.stayStart()))throw new IllegalStateException("Stopped or expired");
                    if(!plan.demo()){if(store.uncertain())throw new IllegalStateException("Uncertain prior submit");store.markSubmitted();}
                    store.state("SUBMITTING",plan.demo()?"[모의] 최종 제출 기록":"최종 제출 전 기록 완료 · 중복 제출 방지",true);
                }
                @Override public void finished(String stage,String message){
                    engine=null;if(!running||closing)return;
                    if(stage.equals("NO_ROOM")&&plan.watch()&&!lookup)parkWatch();
                    else {if(stage.equals("SUCCESS")&&!plan.demo()){store.completed();try{new PhoneRepository(owner).completeDraft(plan);}catch(Exception ignored){/* A draft failure must not turn a confirmed booking into a retry. */}}finish(stage,message);}
                }
            });
            engine.start();
        }catch(Exception e){finish(store.uncertain()?"CHECK_REQUIRED":"FAILED","예약 엔진 시작 실패 · 자동 재시도 없음");}
    }
    private void parkWatch(){
        releaseCpu();
        try {
            long delay=Math.max(Plan.MIN_POLL_SECONDS,plan.pollSeconds)*1000L;
            long untilMidnight=plan.deadline()-SiteClock.now(context);
            if(untilMidnight<=0){finish("STOPPED","입실일 00시가 지나 감시를 종료했습니다.");return;}
            // A deadline alarm may wake earlier solely to terminate, never to query before ten minutes.
            long due=SystemClock.elapsedRealtime()+Math.min(delay,untilMidnight);
            store.watchDueElapsed(due);
            update("WATCHING","빈 객실 없음 · "+plan.pollSeconds/60+"분 이상 간격 · 조회 사이 CPU 절전 · 입실일 00시 종료");
            AlarmReceiver.scheduleWatch(context,due);
            main.removeCallbacks(watchDue);main.postDelayed(watchDue,Math.min(delay,untilMidnight));
        }catch(Exception e){finish("FAILED","감시 시각 저장·알람 예약 실패 · 안전 중지");}
    }
    private void holdCpu(){
        if(wake==null){wake=context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"SwimPhone:ReservationEngine:"+slot);wake.setReferenceCounted(false);}
        wake.acquire(120000);
    }
    private void releaseCpu(){main.removeCallbacks(renew);if(wake!=null&&wake.isHeld())wake.release();}
    private void update(String stage,String message){store.state(stage,message,true);context.getSystemService(NotificationManager.class).notify(10+slot,ReservationService.notice(context,message,true,slot));}
    private void finish(String stage,String message){
        if(closing)return;closing=true;running=false;main.removeCallbacksAndMessages(null);AlarmReceiver.cancel(context);
        if(engine!=null){PhoneExecution old=engine;engine=null;old.cancel();}
        releaseCpu();store.watchDueElapsed(0);
        store.state(stage,message==null?"작업 중지":message,false);context.getSystemService(NotificationManager.class).cancel(10+slot);
        context.getSystemService(NotificationManager.class).notify(20+slot,ReservationService.notice(context,store.message(),false,slot));owner.taskDone(slot);
    }
}
