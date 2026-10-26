package kr.swim.phone;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.http.SslError;
import android.os.*;
import android.provider.Settings;
import android.webkit.*;
import android.view.*;
import org.json.*;
import java.util.*;
import java.io.*;

/** Bundled add-on presentation; native, server-independent reservation service remains separate. */
public final class MainActivity extends Activity {
    static final String UI_HOST="phone.swim.invalid";
    static final Set<String> UI_FILES=Set.of("index.html","styles.css","phone.css","phone.js","toast.js","phone-features.js","booking-flow.js","booking-flow.css","ha-map.png","date-picker.js","stay-calendar.js","site-choice.js","site-map.png");
    WebView screen;
    AppUpdates updates;
    private String pendingMapExport;
    private volatile long lookupRequest=0;
    private volatile boolean confirmationPending=false;
    private volatile String pendingPlanId="";
    private LocalStore store;private PhoneRepository repository;
    private final Handler main=new Handler(Looper.getMainLooper());
    static boolean localUi(Uri uri,boolean mainFrame){
        return "https".equals(uri.getScheme())&&UI_HOST.equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)
            &&uri.getPath()!=null&&uri.getPath().startsWith("/")&&uri.getPath().length()>1&&(UI_FILES.contains(uri.getPath().substring(1))||!mainFrame&&uri.getPath().matches("/map/[a-f0-9-]{36}\\.jpg"))&&(!mainFrame||"/index.html".equals(uri.getPath()));
    }
    @SuppressLint({"SetJavaScriptEnabled","AddJavascriptInterface"})
    @Override public void onCreate(Bundle state){
        super.onCreate(state);receiveNotificationIntent(getIntent());pendingMapExport=state==null?null:state.getString("pendingMapExport");store=new LocalStore(this);repository=new PhoneRepository(this);updates=new AppUpdates(this);
        android.widget.FrameLayout root=new android.widget.FrameLayout(this);screen=new WebView(this);root.addView(screen,new android.widget.FrameLayout.LayoutParams(-1,-1));setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets b=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());v.setPadding(b.left,b.top,b.right,b.bottom);}else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
        WebSettings settings=screen.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(false);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        WebView.setWebContentsDebuggingEnabled(false);CookieManager.getInstance().setAcceptThirdPartyCookies(screen,false);
        screen.addJavascriptInterface(new Object(){@JavascriptInterface public String request(String request){return api(request);}},"Phone");
        screen.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(!localUi(request.getUrl(),request.isForMainFrame()))return denied();
                if(request.getUrl().getPath().equals("/ha-map.png")){try{return new WebResourceResponse("image/png",null,new FileInputStream(HaDisplay.photo(MainActivity.this)));}catch(Exception e){return denied();}}
                if(request.getUrl().getPath().startsWith("/map/")){try{String id=request.getUrl().getLastPathSegment().replace(".jpg","");return new WebResourceResponse("image/jpeg",null,new FileInputStream(new MapPhotos(MainActivity.this).file(id)));}catch(Exception e){return denied();}}
                String path=request.getUrl().getLastPathSegment();String type=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".png")?"image/png":"text/html";
                try{return new WebResourceResponse(type,"UTF-8",200,"OK",Map.of("Cache-Control","no-store","Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"),getAssets().open("ui/"+path));}catch(IOException e){return denied();}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !localUi(request.getUrl(),true);}
            @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();}
        });
        screen.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsConfirm(WebView v,String url,String message,JsResult result){
                if(!localUi(Uri.parse(url),true)){result.cancel();return true;}
                new AlertDialog.Builder(MainActivity.this).setTitle("확인").setMessage(message).setNegativeButton("취소",(d,w)->result.cancel()).setPositiveButton("확인",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;
            }
            @Override public boolean onJsAlert(WebView v,String url,String message,JsResult result){
                if(!localUi(Uri.parse(url),true)){result.cancel();return true;}
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("확인",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;
            }
        });
        screen.loadUrl("https://"+UI_HOST+"/index.html");
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);receiveNotificationIntent(intent);refreshRuntime();}
    private void receiveNotificationIntent(Intent intent){if(intent!=null&&"kr.swim.phone.OPEN_LOOKUP".equals(intent.getAction()))lookupRequest=SystemClock.elapsedRealtimeNanos();}
    private WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Map.of(),new ByteArrayInputStream(new byte[0]));}
    String api(String raw){
        try{
            if(raw==null||raw.length()>100000)throw new IllegalArgumentException("요청 크기 초과");
            JSONObject request=new JSONObject(raw);String action=request.getString("action");JSONObject data=request.optJSONObject("data");if(data==null)data=new JSONObject();
            Object result;
            switch(action){
                case "load":result=repository.load().put("rooms",new JSONArray(RoomCatalog.NAMES)).put("version",BuildConfig.VERSION_NAME);break;
                case "checkUpdates":main.post(()->updates.check(true));result="앱 업데이트 확인 중";break;
                case "syncTime":PhoneReads.time(this);result="서버 시각 동기화 중";break;
                case "monthly":PhoneReads.monthly(this,data.getString("month"));result="월별 현황 조회 중";break;
                case "calendarMonth":result=PhoneReads.calendar(this,data.getString("month"),data.optBoolean("force"));break;
                case "lookup":{JSONArray profiles=data.optJSONArray("profiles");if(profiles==null)profiles=repository.load().getJSONArray("profiles");JSONArray selected=profiles;main.post(()->{try{CampLookup.begin(this,selected);}catch(Exception e){if(CampLookup.active!=null){message("이미 예약 내역을 조회 중입니다.");return;}try{store.saveDocument("lookup-result",new JSONObject().put("pending",false).put("error",e instanceof IllegalArgumentException||e instanceof IllegalStateException?e.getMessage():"예약조회 초기화 실패 · 앱을 다시 열어 주세요.").put("capturedAt",System.currentTimeMillis()));}catch(Exception ignored){}}});result="예약 내역 조회 중";break;}
                case "lookupStop":main.post(CampLookup::cancel);result="조회 중지";break;
                case "maps":result=new JSONObject().put("photos",new JSONArray()).put("selected","");break;
                case "haSync":HaDisplay.sync(this,false);result="HA 표시 동기화";break;
                case "mapPick":case "mapExport":case "mapAction":throw new IllegalStateException("사진은 애드온에서만 관리합니다.");


                case "state":result=runtimeState();break;
                case "draft":result=repository.saveDraft(data);break;
                case "draftReset":{String mode=data.getString("mode");if(!java.util.Set.of("reserve","watch","multiple","profiles-parallel").contains(mode))throw new IllegalArgumentException("예약 화면을 확인하세요.");JSONObject state=repository.load(),drafts=state.optJSONObject("drafts");if(drafts!=null)drafts.remove(mode);JSONObject latest=state.optJSONObject("draft");if(latest!=null&&mode.equals(latest.optString("mode","reserve")))state.put("draft",new Plan().json().put("mode",mode));store.saveDocument("phone-ui-v1",state);result=state;break;}
                case "ui":result=repository.saveUi(data);break;
                case "profilePut":result=repository.put("profiles",data);break;
                case "profileDelete":result=repository.delete("profiles",data.getString("id"));break;
                case "planPut":result=repository.put("plans",data);break;
                case "planDelete":result=repository.delete("plans",data.getString("id"));break;
                case "run":{AppUpdates.requireSupported(this);if(confirmationPending)throw new IllegalStateException("시작 확인을 먼저 마쳐 주세요.");String id=data.optString("planId");Plan plan=id.isEmpty()?PhoneRepository.plan(data,true):repository.registeredPlan(id);pendingPlanId=id;confirmationPending=true;main.post(()->confirmRun(plan,id));result="폰 실행 확인 창을 확인하세요.";break;}
                case "inspect":{if(confirmationPending)throw new IllegalStateException("시작 확인을 먼저 마쳐 주세요.");Plan plan=PhoneRepository.plan(data,false);plan.validate(true);main.post(()->startPlan(plan,true));result="객실 조회를 요청했습니다. 실제 상태는 로그에서 확인하세요.";break;}
                case "demo":main.post(()->{PhoneEngine.demoScenario="camp";startPlan(Plan.sample(),false);});result="새 사이트 모의 테스트 시작 요청";break;
                case "stop":{String id=data.optString("planId");main.post(()->{try{if(id.isEmpty())PlanScheduler.stop(this);else PlanScheduler.stopPlan(this,id);}catch(Exception e){message(e.getMessage());}finally{refreshRuntime();}});result="중지 요청";break;}
                case "acknowledge":main.post(()->{if(PhoneRuns.anyActive(this)){message("작업을 먼저 중지해 주세요.");return;}new AlertDialog.Builder(this).setTitle("공식 예약 내역을 확인했나요?").setMessage("예약을 취소하는 버튼이 아닙니다. 실제 내역을 확인한 경우에만 제출 잠금을 해제하세요.").setNegativeButton("취소",null).setPositiveButton("내역 확인 완료",(d,w)->PhoneRuns.acknowledge(this)).show();});result="확인 요청";break;
                case "batterySettings":main.post(()->safeSettings(()->DeviceSettings.openBatterySettings(this)));result="시스템 설정 열기 요청";break;
                case "batteryRequest":main.post(this::batteryRequest);result="배터리 허용 상태 확인";break;
                case "notifications":main.post(()->safeSettings(()->{if(Build.VERSION.SDK_INT>=33)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},1);else startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));}));result="알림 권한 요청";break;
                case "alarmSettings":main.post(()->safeSettings(()->{if(Build.VERSION.SDK_INT>=31)startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));else message("별도 알람 권한이 필요 없는 기기입니다.");}));result="알람 설정 요청";break;
                case "openReservation":{String url=SiteLinks.reservation(data.getString("date"));main.post(()->open(Uri.parse(url)));result="공식 예약 페이지 열기";break;}
                case "openReceipts":main.post(()->open(SiteLinks.receipts()));result="공식 예약 내역 열기";break;
                case "openMonthly":main.post(()->open(Uri.parse("https://"+PhoneEngine.HOST+"/camp/")));result="공식 달력 열기";break;
                case "copyLogs":main.post(()->getSystemService(android.content.ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("쉼오지 실행 기록",store.log())));result="실행 기록을 복사했습니다.";break;
                default:throw new IllegalArgumentException("이 앱에서 지원하지 않는 기능입니다.");
            }
            return new JSONObject().put("ok",true).put("data",result).toString();
        }catch(Exception e){try{return new JSONObject().put("ok",false).put("error",e instanceof IllegalArgumentException||e instanceof IllegalStateException?e.getMessage():"폰 내부 저장·처리 실패. 자동 초기화하지 않았습니다.").toString();}catch(Exception ignored){return "{\"ok\":false,\"error\":\"처리 실패\"}";}}
    }
    JSONObject runtimeState()throws Exception{
        android.os.PowerManager power=getSystemService(android.os.PowerManager.class);
        JSONObject editor=repository.load(),run=store.loadDocument("run");
        repository.bindLegacyRun();PhoneRuns.reconcile(this);
        return PhoneRuns.snapshot(this).put("haDisplay",HaDisplay.status(this)).put("lookupRequest",lookupRequest).put("confirmationPending",confirmationPending).put("pendingPlanId",pendingPlanId)
            .put("notifications",getSystemService(NotificationManager.class).areNotificationsEnabled()).put("battery",power.isIgnoringBatteryOptimizations(getPackageName())).put("alarm",AlarmReceiver.permitted(this)).put("availability",new LocalStore(this,6).availability()).put("inspectBusy",PhoneInspection.alive(6)).put("catalog",new JSONArray(RoomCatalog.NAMES)).put("clock",SiteClock.state(this)).put("clockResult",store.loadDocument("clock-result")).put("monthly",store.loadDocument("monthly-result")).put("lookup",store.loadDocument("lookup-result")).put("draftClearedAt",editor.optLong("draftClearedAt")).put("clearedDraft",editor.optJSONObject("clearedDraft"));
    }
    private void refreshRuntime(){if(screen!=null&&!isFinishing()&&!isDestroyed())screen.evaluateJavascript("window.refreshPhoneRuntime?.()",null);}
    private void confirmRun(Plan plan,String id){
        if(isFinishing()||isDestroyed()){confirmationPending=false;pendingPlanId="";return;}
        new AlertDialog.Builder(this).setTitle("폰에서 실제 예약 실행")
            .setMessage(RunNotice.message(plan,SiteClock.now(this)))
            .setNegativeButton("취소",null).setPositiveButton("시작",(d,w)->startPlan(plan,false,id))
            .setOnDismissListener(d->{confirmationPending=false;pendingPlanId="";refreshRuntime();}).show();
        refreshRuntime();
    }
    private void startPlan(Plan plan,boolean lookup){startPlan(plan,lookup,"");}
    private void startPlan(Plan plan,boolean lookup,String id){try{PlanScheduler.start(this,plan,lookup,id);}catch(Exception e){message(e.getMessage()==null?"실행 시작 실패":e.getMessage());}finally{refreshRuntime();}}
    private void batteryRequest(){
        if(getSystemService(android.os.PowerManager.class).isIgnoringBatteryOptimizations(getPackageName())){new AlertDialog.Builder(this).setTitle("배터리 예외가 이미 허용돼 있습니다").setMessage("추가 요청은 필요 없습니다. 제조사별 절전 제한은 시스템 설정에서 확인하세요.").setNegativeButton("닫기",null).setPositiveButton("배터리 설정 열기",(d,w)->safeSettings(()->DeviceSettings.openBatterySettings(this))).show();return;}
        new AlertDialog.Builder(this).setTitle("배터리 예외 허용 요청").setMessage("잠금·절전 중 예약 실행을 위한 예외입니다. 다음 시스템 창에서 직접 허용해 주세요.").setNegativeButton("취소",null).setPositiveButton("허용 요청",(d,w)->safeSettings(()->startActivity(DeviceSettings.batteryRequest(this)))).show();
    }
    private void safeSettings(Runnable action){try{action.run();}catch(Exception e){message("설정 화면을 열지 못했습니다. 시스템 앱 정보에서 직접 확인해 주세요.");}}
    private void open(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception e){message("브라우저를 열지 못했습니다.");}}
    private void message(String text){if(!isFinishing()&&screen!=null)screen.evaluateJavascript("window.showFloatingMessage?.("+JSONObject.quote(text)+",{error:true})",null);}
    @Override protected void onResume(){super.onResume();if(store!=null)PhoneRuns.reconcile(this);if(updates!=null)updates.resume();HaDisplay.sync(this,false);refreshRuntime();}
    @Override protected void onPause(){PhoneInspection.cancel();if(updates!=null)updates.pause();super.onPause();}
    Intent mapExportIntent(String id)throws Exception{
        new MapPhotos(this).registeredFile(id);
        return new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("image/jpeg").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"swim-map-"+id+".jpg");
    }
    @Override protected void onSaveInstanceState(Bundle state){state.putString("pendingMapExport",pendingMapExport);super.onSaveInstanceState(state);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);
        if(request==46){
            String id=pendingMapExport;pendingMapExport=null;
            if(result==RESULT_OK&&data!=null&&data.getData()!=null&&id!=null){
                Uri destination=data.getData();
                new Thread(()->{try{
                    // Validate membership before opening the user-selected destination.
                    MapPhotos photos=new MapPhotos(this);photos.registeredFile(id);
                    try(OutputStream out=getContentResolver().openOutputStream(destination,"w")){if(out==null)throw new IOException();photos.exportTo(id,out);}
                    main.post(()->message("배치도 사진을 저장했습니다."));
                }catch(Exception e){main.post(()->message("사진을 저장하지 못했습니다. 저장 위치·여유 공간과 등록 사진을 확인하세요."));}},"map-export").start();
            }
            return;
        }
if(request==45&&result==RESULT_OK&&data!=null&&data.getData()!=null){Uri uri=data.getData();new Thread(()->{try{new MapPhotos(this).add(uri);main.post(()->{if(screen!=null)screen.evaluateJavascript("window.refreshPhoneMaps?.()",null);});}catch(Exception e){main.post(()->message("사진을 저장하지 못했습니다. 10MB 이내 이미지·최대 6장을 확인하세요."));}},"map-import").start();}}
    @Override protected void onDestroy(){if(updates!=null)updates.destroy();CampLookup.cancel();if(screen!=null){screen.removeJavascriptInterface("Phone");screen.stopLoading();screen.destroy();screen=null;}super.onDestroy();}
}
