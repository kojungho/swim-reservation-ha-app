package kr.swim.phone;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.MutableContextWrapper;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** The native service owns the document; the Activity only attaches its existing view. */
public final class PaymentActivity extends Activity {
    private static final Map<String,CampPhoneEngine> sessions=new LinkedHashMap<>();
    private static final java.util.Set<String> opened=new java.util.HashSet<>();
    private static MainActivity foreground;
    private String sessionId;
    private FrameLayout frame;
    private CampPhoneEngine engine;

    static String register(CampPhoneEngine engine){
        String id=UUID.randomUUID().toString();
        sessions.put(id,engine);
        if(!presentPending())notifyWaiting(engine,id);
        return id;
    }
    static void mainResumed(MainActivity activity){foreground=activity;presentPending();}
    static void mainPaused(MainActivity activity){if(foreground==activity)foreground=null;}
    static boolean presentPending(){
        MainActivity activity=foreground;
        if(activity==null||activity.isFinishing()||!activity.hasWindowFocus()
            ||!activity.getSystemService(android.os.PowerManager.class).isInteractive()
            ||activity.getSystemService(android.app.KeyguardManager.class).isKeyguardLocked())return false;
        for(String id:sessions.keySet()){
            if(opened.add(id)){
                activity.startActivity(intent(activity,id));
                return true;
            }
        }
        return false;
    }
    private static void notifyWaiting(CampPhoneEngine engine,String id){
        int slot=RunContext.slot(engine.context);
        android.app.NotificationManager manager=engine.context.getSystemService(android.app.NotificationManager.class);
        ReservationService.channel(engine.context);
        android.app.PendingIntent open=android.app.PendingIntent.getActivity(engine.context,0,intent(engine.context,id),android.app.PendingIntent.FLAG_IMMUTABLE);
        manager.notify(700+slot,new android.app.Notification.Builder(engine.context,ReservationService.RESULT_CHANNEL)
            .setSmallIcon(R.drawable.ic_camp).setVisibility(android.app.Notification.VISIBILITY_PRIVATE)
            .setContentTitle("쉼오지 예약 · 결제 대기 중").setContentText("눌러서 공식 결제창 이어보기")
            .setContentIntent(open).build());

    }
    static void remove(String id){
        CampPhoneEngine engine=sessions.remove(id);
        if(engine!=null){
            engine.context.getSystemService(android.app.NotificationManager.class).cancel(700+RunContext.slot(engine.context));
            if(engine.web!=null && engine.web.getContext() instanceof MutableContextWrapper){
                Context owner=((MutableContextWrapper)engine.web.getContext()).getBaseContext();
                if(owner instanceof PaymentActivity)((PaymentActivity)owner).finish();
            }
        }
        opened.remove(id);
    }
    private static Intent intent(Context context,String id){
        return new Intent(context,PaymentActivity.class).setData(Uri.parse("swim-checkout:"+id));
    }
    static Intent forSlot(Context context,int slot){
        for(Map.Entry<String,CampPhoneEngine> entry:sessions.entrySet()){
            if(RunContext.slot(entry.getValue().context)==slot)return intent(context,entry.getKey());
        }
        return null;
    }
    @Override protected void onCreate(Bundle state){
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        Uri uri=getIntent().getData();
        String id=uri==null?"":uri.getSchemeSpecificPart();
        engine=sessions.get(id);
        if(engine==null||engine.web==null){Toast.makeText(this,"결제 화면이 종료됐습니다. 공식 예약 내역을 확인하세요.",Toast.LENGTH_LONG).show();finish();return;}
        sessionId=id;
        opened.add(id);
        frame=new FrameLayout(this);
        android.widget.LinearLayout layout=new android.widget.LinearLayout(this);
        if(android.os.Build.VERSION.SDK_INT>=35)layout.setOnApplyWindowInsetsListener((view,insets)->{
            android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
            return insets;
        });
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        android.widget.Button stop=new android.widget.Button(this);
        stop.setText("결제창 닫고 예약 작업 중지");
        stop.setOnClickListener(v->{
            if(engine!=null && engine==sessions.get(sessionId) && !engine.ended)
                PlanScheduler.stopSlot(this,RunContext.slot(engine.context));
            finish();
        });
        layout.addView(stop);
        layout.addView(frame,new android.widget.LinearLayout.LayoutParams(-1,0,1f));
        setContentView(layout);
        if(engine.web.getParent() instanceof ViewGroup)((ViewGroup)engine.web.getParent()).removeView(engine.web);
        ((MutableContextWrapper)engine.web.getContext()).setBaseContext(this);
        frame.addView(engine.web);
    }
    @Override protected void onResume(){
        super.onResume();
        if(engine!=null){engine.checkoutVisible(true);engine.context.getSystemService(android.app.NotificationManager.class).cancel(700+RunContext.slot(engine.context));}
    }
    @Override protected void onStop(){
        super.onStop();
        if(sessionId!=null && sessions.containsKey(sessionId)){
            engine.checkoutVisible(false);
            if(!engine.returnedFromPayment)notifyWaiting(engine,sessionId);
        }
    }
    static PaymentActivity visible(android.webkit.WebView view){
        if(!(view.getContext() instanceof MutableContextWrapper))return null;
        Context base=((MutableContextWrapper)view.getContext()).getBaseContext();
        if(!(base instanceof PaymentActivity))return null;
        PaymentActivity activity=(PaymentActivity)base;
        return !activity.isFinishing() && activity.hasWindowFocus()?activity:null;
    }
    @Override protected void onDestroy(){
        if(engine!=null && engine.web!=null && engine.web.getParent()==frame){
            frame.removeView(engine.web);
            ((MutableContextWrapper)engine.web.getContext()).setBaseContext(engine.context);
        }
        if(isFinishing() && engine!=null && engine.returnedFromPayment)
            engine.finish("CHECK_REQUIRED","공식 결제 결과 화면을 닫았습니다. 예약 내역에서 상태를 확인하세요.");
        super.onDestroy();
    }
}
