package kr.swim.phone;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.MutableContextWrapper;
import android.os.Bundle;
import android.webkit.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Read-only device probe. Supply a real site's booking URL without personal information. */
public final class PaymentHandoffReadRunner extends Instrumentation {
    private String url;
    private boolean tapInShade;
    @Override public void onCreate(Bundle args){super.onCreate(args);url=args.getString("url");tapInShade="true".equals(args.getString("tapInShade"));start();}
    @Override public void onStart(){
        Bundle report=new Bundle();
        CampPhoneEngine[] engines=new CampPhoneEngine[1];
        String[] session=new String[1];
        Activity activity=null;
        Activity landing=null;
        try{
            if(url==null||!url.startsWith("https://www.swimozicamp.com/camp/book.php?"))throw new IllegalArgumentException("official booking URL required");
            CountDownLatch loaded=new CountDownLatch(1);
            runOnMainSync(()->{
                try{
                    RunContext ctx=new RunContext(getTargetContext(),1);
                    CampPhoneEngine engine=new CampPhoneEngine(ctx,new Plan(),false,null);
                    engines[0]=engine;
                    engine.web=new WebView(new MutableContextWrapper(ctx));
                    PhoneSessions.attach(engine.web,"handoff-read-probe");
                    engine.web.getSettings().setJavaScriptEnabled(true);
                    engine.web.setWebViewClient(new WebViewClient(){
                        @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                            if(!"GET".equals(request.getMethod()))return new WebResourceResponse("text/plain","UTF-8",new java.io.ByteArrayInputStream(new byte[0]));
                            return null;
                        }
                        @Override public void onPageFinished(WebView view,String address){loaded.countDown();}
                    });
                    engine.web.loadUrl(url);
                }catch(Exception e){throw new IllegalStateException(e);}
            });
            if(!loaded.await(35,TimeUnit.SECONDS))throw new AssertionError("official page timeout");
            if(!"true".equals(js(engines[0].web,"Boolean(document.querySelector('form.js-book input[name=pay_method][value=card]') && (window.handoffReadMarker='existing-document'))")))throw new AssertionError("card form missing");
            CampPhoneEngine engine=engines[0];
            engine.plan.manualCard=true;engine.submitted=true;
            if(!engine.permitted(android.net.Uri.parse("https://www.swimozicamp.com/camp/pay.php"),true)
                ||engine.permitted(android.net.Uri.parse("https://other.invalid/camp/pay.php"),true))throw new AssertionError("payment redirect policy");
            if(CardAppLaunch.resolve(android.net.Uri.parse("intent://pay#Intent;scheme=shinhan-sr-ansimclick;package=com.shcard.smartpay;end"))==null)throw new AssertionError("card app route");
            landing=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            long deadline=System.currentTimeMillis()+10000;
            while(!landing.hasWindowFocus()&&System.currentTimeMillis()<deadline)Thread.sleep(100);
            ActivityMonitor monitor=addMonitor(PaymentActivity.class.getName(),null,false);
            runOnMainSync(()->session[0]=PaymentActivity.register(engine));
            activity=waitForMonitorWithTimeout(monitor,10000);
            if(activity==null)throw new AssertionError("foreground auto-open failed");
            if(!"true".equals(js(engine.web,"window.handoffReadMarker==='existing-document' && document.querySelector('.sum-title').textContent.trim()==='하늘존해'")))throw new AssertionError("document changed");
            Activity first=activity,main=landing;
            runOnMainSync(()->{PaymentActivity.remove(session[0]);main.finish();first.finish();});
            waitForIdleSync();
            runOnMainSync(()->session[0]=PaymentActivity.register(engine));
            android.app.NotificationManager manager=getTargetContext().getSystemService(android.app.NotificationManager.class);
            android.app.PendingIntent notificationAction=null;
            for(int i=0;i<50&&notificationAction==null;i++){
                for(android.service.notification.StatusBarNotification n:manager.getActiveNotifications())
                    if(n.getId()==701 && n.getNotification().contentIntent!=null)notificationAction=n.getNotification().contentIntent;
                if(notificationAction==null)Thread.sleep(100);
            }
            if(notificationAction==null)throw new AssertionError("background notification missing");
            monitor=addMonitor(PaymentActivity.class.getName(),null,false);
            // Exercise the PendingIntent published to Android's notification manager.
            if(!tapInShade){
            getUiAutomation().adoptShellPermissionIdentity("android.permission.START_ACTIVITIES_FROM_BACKGROUND");
            try{
                android.app.ActivityOptions options=android.app.ActivityOptions.makeBasic();
                if(android.os.Build.VERSION.SDK_INT>=34)options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                notificationAction.send(getTargetContext(),0,null,null,null,null,options.toBundle());
            }finally{getUiAutomation().dropShellPermissionIdentity();}
            }else{Bundle status=new Bundle();status.putString("stream","WAIT_FOR_SHADE_TAP");sendStatus(0,status);}
            activity=waitForMonitorWithTimeout(monitor,tapInShade?60000:10000);
            if(activity==null||!"true".equals(js(engine.web,"window.handoffReadMarker==='existing-document'")))throw new AssertionError("notification handoff failed");
            report.putString("stream","PASS live booking form, foreground auto-open, background notification action, original document retained, payment route checks, no order submitted");
        }catch(Throwable e){report.putString("stream","FAIL "+e);}
        finally{
            Activity last=activity;
            runOnMainSync(()->{if(last!=null)last.finish();PaymentActivity.remove(session[0]);});
            waitForIdleSync();
            runOnMainSync(()->{if(engines[0]!=null&&engines[0].web!=null)engines[0].web.destroy();});
        }
        finish(report.getString("stream").startsWith("PASS")?Activity.RESULT_OK:Activity.RESULT_CANCELED,report);
    }
    private String js(WebView view,String expr)throws Exception{
        CountDownLatch done=new CountDownLatch(1);String[] value=new String[1];
        runOnMainSync(()->view.evaluateJavascript(expr,r->{value[0]=r;done.countDown();}));
        if(!done.await(10,TimeUnit.SECONDS))throw new AssertionError("document evaluation timed out");
        return value[0];
    }
}
