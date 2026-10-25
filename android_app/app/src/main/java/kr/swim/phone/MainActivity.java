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
    static final Set<String> UI_FILES=Set.of("index.html","styles.css","phone.css","phone.js","date-picker.js","site-map.png");
    WebView screen;
    private LocalStore store;private PhoneRepository repository;
    private final Handler main=new Handler(Looper.getMainLooper());
    static boolean localUi(Uri uri,boolean mainFrame){
        return "https".equals(uri.getScheme())&&UI_HOST.equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)
            &&uri.getPath()!=null&&uri.getPath().startsWith("/")&&uri.getPath().length()>1&&UI_FILES.contains(uri.getPath().substring(1))&&(!mainFrame||"/index.html".equals(uri.getPath()));
    }
    @SuppressLint({"SetJavaScriptEnabled","AddJavascriptInterface"})
    @Override public void onCreate(Bundle state){
        super.onCreate(state);store=new LocalStore(this);repository=new PhoneRepository(this);
        android.widget.FrameLayout root=new android.widget.FrameLayout(this);screen=new WebView(this);root.addView(screen,new android.widget.FrameLayout.LayoutParams(-1,-1));setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets b=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.ime());v.setPadding(b.left,b.top,b.right,b.bottom);}else v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
        WebSettings settings=screen.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(false);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        WebView.setWebContentsDebuggingEnabled(false);CookieManager.getInstance().setAcceptThirdPartyCookies(screen,false);
        screen.addJavascriptInterface(new Object(){@JavascriptInterface public String request(String request){return api(request);}},"Phone");
        screen.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                if(!localUi(request.getUrl(),request.isForMainFrame()))return denied();
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
        AppUpdates.check(this,false);
    }
    private WebResourceResponse denied(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Map.of(),new ByteArrayInputStream(new byte[0]));}
    String api(String raw){
        try{
            if(raw==null||raw.length()>100000)throw new IllegalArgumentException("요청 크기 초과");
            JSONObject request=new JSONObject(raw);String action=request.getString("action");JSONObject data=request.optJSONObject("data");if(data==null)data=new JSONObject();
            Object result;
            switch(action){
                case "load":result=repository.load().put("rooms",new JSONArray(RoomCatalog.NAMES)).put("version",BuildConfig.VERSION_NAME);break;
                case "checkUpdates":main.post(()->AppUpdates.check(this,true));result="앱 업데이트 확인 중";break;
                case "state":result=runtimeState();break;
                case "draft":result=repository.saveDraft(data);break;
                case "ui":result=repository.saveUi(data);break;
                case "profilePut":result=repository.put("profiles",data);break;
                case "profileDelete":result=repository.delete("profiles",data.getString("id"));break;
                case "planPut":result=repository.put("plans",data);break;
                case "planDelete":result=repository.delete("plans",data.getString("id"));break;
                case "run":{Plan plan=PhoneRepository.plan(data,true);main.post(()->confirmRun(plan));result="폰 실행 확인 창을 확인하세요.";break;}
                case "inspect":{Plan plan=PhoneRepository.plan(data,false);plan.validate(true);main.post(()->startPlan(plan,true));result="객실 조회를 요청했습니다. 실제 상태는 로그에서 확인하세요.";break;}
                case "demo":main.post(()->{PhoneEngine.demoScenario="camp";startPlan(Plan.sample(),false);});result="새 사이트 모의 테스트 시작 요청";break;
                case "stop":main.post(()->PlanScheduler.stop(this));result="중지 요청";break;
                case "acknowledge":main.post(()->{if(store.active()){message("작업을 먼저 중지해 주세요.");return;}new AlertDialog.Builder(this).setTitle("공식 예약 내역을 확인했나요?").setMessage("예약을 취소하는 버튼이 아닙니다. 실제 내역을 확인한 경우에만 제출 잠금을 해제하세요.").setNegativeButton("취소",null).setPositiveButton("내역 확인 완료",(d,w)->store.acknowledgeReceiptCheck()).show();});result="확인 요청";break;
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
        return new JSONObject().put("stage",store.stage()).put("message",store.message()).put("active",store.active()).put("uncertain",store.uncertain()).put("log",store.log())
            .put("notifications",getSystemService(NotificationManager.class).areNotificationsEnabled()).put("battery",power.isIgnoringBatteryOptimizations(getPackageName())).put("alarm",AlarmReceiver.permitted(this));
    }
    private void confirmRun(Plan plan){
        if(isFinishing()||isDestroyed())return;
        new AlertDialog.Builder(this).setTitle("폰에서 실제 예약 실행")
            .setMessage(plan.date+" / "+plan.nights+"박\n"+plan.rooms+"\n"+(plan.watch()?"최소 10분 간격으로 취소 자리를 감시하며 발견 시 객실 하나를 예약합니다.":"지정한 시각에 예약정보 화면을 열어 입력·필수 동의 후 제출합니다. 최종 제출 시각과 다릅니다.")+"\n새 공식 사이트에서 무통장입금 예약을 신청합니다. 입금은 직접 해야 합니다. 같은 예약을 HA와 동시에 실행하지 마세요. 폰 실제 예약 성공은 아직 검증하지 않았습니다.")
            .setNegativeButton("취소",null).setPositiveButton("시작",(d,w)->startPlan(plan,false)).show();
    }
    private void startPlan(Plan plan,boolean lookup){try{PlanScheduler.start(this,plan,lookup);}catch(Exception e){message(e.getMessage()==null?"실행 시작 실패":e.getMessage());}}
    private void batteryRequest(){
        if(getSystemService(android.os.PowerManager.class).isIgnoringBatteryOptimizations(getPackageName())){new AlertDialog.Builder(this).setTitle("배터리 예외가 이미 허용돼 있습니다").setMessage("추가 요청은 필요 없습니다. 제조사별 절전 제한은 시스템 설정에서 확인하세요.").setNegativeButton("닫기",null).setPositiveButton("배터리 설정 열기",(d,w)->safeSettings(()->DeviceSettings.openBatterySettings(this))).show();return;}
        new AlertDialog.Builder(this).setTitle("배터리 예외 허용 요청").setMessage("잠금·절전 중 예약 실행을 위한 예외입니다. 다음 시스템 창에서 직접 허용해 주세요.").setNegativeButton("취소",null).setPositiveButton("허용 요청",(d,w)->safeSettings(()->startActivity(DeviceSettings.batteryRequest(this)))).show();
    }
    private void safeSettings(Runnable action){try{action.run();}catch(Exception e){message("설정 화면을 열지 못했습니다. 시스템 앱 정보에서 직접 확인해 주세요.");}}
    private void open(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception e){message("브라우저를 열지 못했습니다.");}}
    private void message(String text){if(!isFinishing())new AlertDialog.Builder(this).setMessage(text).setPositiveButton("확인",null).show();}
    @Override protected void onResume(){super.onResume();if(store!=null&&store.active()&&!store.stage().equals("WAITING")&&!ReservationService.alive())store.state(store.uncertain()?"CHECK_REQUIRED":"STOPPED","실행 서비스 종료 확인 · 자동 재제출 없이 중지",false);}
    @Override protected void onDestroy(){if(screen!=null){screen.removeJavascriptInterface("Phone");screen.stopLoading();screen.destroy();screen=null;}super.onDestroy();}
}
