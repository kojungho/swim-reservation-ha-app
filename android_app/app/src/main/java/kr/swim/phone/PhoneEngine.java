package kr.swim.phone;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.net.http.SslError;
import android.os.*;
import android.webkit.*;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.io.*;
import java.util.*;

/** Service-owned WebView executes the site's real forms. No Activity, HA, cloud runtime or JS interface. */
public final class PhoneEngine {
    // Instrumentation-only seam. No UI/Intent/persisted configuration can set it.
    static volatile String demoScenario="";
    static volatile int demoDocumentRequests=0;
    public interface Events {
        void stage(String stage,String message);
        void beforeFinal() throws Exception;
        void finished(String stage,String message);
    }
    private final Context context;
    private final Plan plan;
    private final Events events;
    private final Handler main=new Handler(Looper.getMainLooper());
    private WebView web;
    private boolean ended=false,finalSent=false;
    private int phase=0;
    private final boolean lookup;
    private String selected="",processed="";
    private final String helpers;
    private final Runnable timeout=()->finish(finalSent?"CHECK_REQUIRED":"FAILED",finalSent?"전송 뒤 응답 시간 초과 · 예약 내역 확인 필요 · 재제출하지 않습니다.":"사이트 응답 시간 초과 · 중지했습니다.");
    public static final String HOST="www.swimozicamp.com";
    private CampPhoneEngine camp;
    private BatchPhoneEngine batch;
    private static final String DEMO_HOST="demo.swim.invalid";
    public PhoneEngine(Context c,Plan p,boolean lookup,Events events)throws IOException {
        context=c;plan=p;this.lookup=lookup;this.events=events;
        helpers=asset(c,"engine.js");
    }
    static String asset(Context c,String path)throws IOException{try(InputStream in=c.getAssets().open(path);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toString("UTF-8");}}
    private String origin(){return "https://"+(plan.demo()?DEMO_HOST:HOST);}
    public static boolean permitted(Uri uri,boolean isMain,boolean demo) {
        if(!"https".equals(uri.getScheme())||!(demo?DEMO_HOST:HOST).equals(uri.getHost())||uri.getPort()!=-1&&uri.getPort()!=443)return false;
        return !isMain || uri.getPath()!=null&&(demo?uri.getPath().matches("/reservation/(reservation1|order_ok[1-4])\\.php"):uri.getPath().matches("/camp/(book\\.php|done\\.php)?"));
    }
    @SuppressLint("SetJavaScriptEnabled")
    public void start() {
        if(plan.batch()){try{batch=new BatchPhoneEngine(context,plan,events);batch.start();}catch(Exception e){finish("FAILED","다인·다중 예약 초기화 실패");}return;}
        if(!plan.demo()||demoScenario.startsWith("camp")){try{camp=new CampPhoneEngine(context,plan,lookup,events);camp.start();}catch(Exception e){finish("FAILED","새 사이트 엔진 초기화 실패");}return;}
        if(Looper.myLooper()!=Looper.getMainLooper())throw new IllegalStateException("Main thread required");
        web=new WebView(context);web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT,false);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);
        s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setDomStorageEnabled(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        WebView.setWebContentsDebuggingEnabled(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsAlert(WebView v,String url,String message,JsResult result){
                result.confirm();
                if(finalSent&&message.matches("(?s).*예약.*완료.*")&&!message.matches("(?s).*(실패|불가|취소|않|못|되지).*"))return true; // Still require the receipt, never trust the alert alone.
                if(!ended)finish(finalSent?"CHECK_REQUIRED":"FAILED","사이트 안내로 중지했습니다. 예약 내역·공식 사이트를 확인하세요.");return true;
            }
            @Override public boolean onJsConfirm(WebView v,String url,String message,JsResult result){
                if(finalSent&&plan.consent&&permitted(Uri.parse(url),true,plan.demo())&&message.matches("(?s).*예약(을|신청을| 신청을)?\\s*(하시겠습니까|진행하시겠습니까|진행할까요).*")){result.confirm();return true;}
                result.cancel();finish(finalSent?"CHECK_REQUIRED":"FAILED","추가 확인창은 자동 승인하지 않습니다. 공식 사이트에서 확인하세요.");return true;
            }
        });
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                if(!permitted(r.getUrl(),r.isForMainFrame(),plan.demo()))return blocked();
                if(plan.demo()){
                    try {String path=r.getUrl().getLastPathSegment();
                        if(r.isForMainFrame())demoDocumentRequests++;
                        if(demoScenario.equals("429")&&path.equals("order_ok3.php"))return new WebResourceResponse("text/html","UTF-8",429,"Too Many Requests",Map.of("Retry-After","30"),new ByteArrayInputStream("Too many requests".getBytes(StandardCharsets.UTF_8)));
                        if(!List.of("reservation1.php","order_ok1.php","order_ok2.php","order_ok3.php","order_ok4.php").contains(path))return blocked();
                        String html=asset(context,"demo/"+path+".html").replace("DEMO_STAY_DATE",plan.date).replace("DEMO_NIGHTS",String.valueOf(plan.nights));
                        if(demoScenario.equals("wrong-receipt")&&path.equals("order_ok4.php"))html=html.replace(plan.date,"2000-01-01");
                        if(demoScenario.equals("wrong-date")&&path.equals("reservation1.php"))html+="<script>document.getElementById('date').value='0'</script>";
                        if(demoScenario.equals("no-room")&&path.equals("reservation1.php"))html=html.replace("name=\"room_rid[0]\"","disabled name=\"room_rid[0]\"");
                        return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                    }catch(Exception e){return blocked();}
                }
                return null;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){
                if(!permitted(r.getUrl(),true,plan.demo())){finish(finalSent?"CHECK_REQUIRED":"FAILED","허용된 예약 경로가 아니어서 중지했습니다.");return true;}return false;
            }
            @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse response){
                if(!r.isForMainFrame()||ended)return;
                Map<String,String> headers=response.getResponseHeaders();boolean local=headers!=null&&"1".equals(headers.get("X-Swim-Local-Blocked"));
                String detail=local?"앱의 허용 경로 정책으로 접속을 차단했습니다. 외부·비보안 경로는 열지 않습니다.":response.getStatusCode()==429?"사이트 요청 제한(HTTP 429). 자동 재시도하지 않습니다.":response.getStatusCode()==403?"사이트 접속 거부(HTTP 403) · 자동 재시도 없음. 예약자 정보 부족으로 단정할 수 없습니다. 공식 브라우저 접속도 확인해 주세요.":"사이트 HTTP "+response.getStatusCode()+" · 중지했습니다.";
                finish(finalSent?"CHECK_REQUIRED":"FAILED",detail);
            }
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError error){if(r.isForMainFrame()&&!ended)finish(finalSent?"CHECK_REQUIRED":"FAILED","네트워크·페이지 오류 · 재제출하지 않습니다.");}
            @Override public void onReceivedSslError(WebView v,SslErrorHandler handler,SslError e){handler.cancel();finish(finalSent?"CHECK_REQUIRED":"FAILED","서버 인증서 확인 실패 · 보안 연결을 우회하지 않습니다.");}
            @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail detail){finish(finalSent?"CHECK_REQUIRED":"FAILED","예약 화면 처리 프로세스 종료 · 자동 재제출 없음");return true;}
            @Override public void onPageFinished(WebView v,String url){
                if(ended||!permitted(Uri.parse(url),true,plan.demo())||url.equals(processed))return;
                processed=url;main.removeCallbacks(timeout);main.postDelayed(timeout,30000);
                eval("read",json->{try{handle(Uri.parse(url).getLastPathSegment(),json);}catch(Exception e){fail();}});
            }
        });
        main.postDelayed(timeout,30000);
        events.stage("PREPARING",plan.demo()?"[모의] 폰 내부 엔진 시작 · 실제 사이트 접속 없음":"폰 내부 엔진에서 객실 조회 중");
        CookieManager.getInstance().removeAllCookies(done->{if(!ended)web.loadUrl(origin()+"/reservation/reservation1.php?id=swim&adaystart="+plan.stayStart()/1000);});
    }
    private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Map.of("X-Swim-Local-Blocked","1"),new ByteArrayInputStream(new byte[0]));}
    private void handle(String page,JSONObject info)throws Exception {
        if(ended)return;
        if(page.equals("reservation1.php")){
            if(phase!=0){fail();return;}phase=1;
            JSONArray dates=info.getJSONArray("dates"),rooms=info.getJSONArray("rooms");
            if(dates.length()==0||rooms.length()==0){finish("FAILED","정상 객실 목록과 숙박 날짜를 확인하지 못해 중지했습니다.");return;}
            for(int i=0;i<dates.length();i++)if(!dates.getString(i).equals(String.valueOf(plan.stayStart()/1000))){finish("FAILED","사이트 숙박 날짜 불일치 · 중지했습니다.");return;}
            if(lookup){
                List<String> available=new ArrayList<>();for(int i=0;i<rooms.length();i++)if(rooms.getJSONObject(i).optBoolean("available"))available.add(rooms.getJSONObject(i).getString("name"));
                finish("INSPECTED","예약 가능한 객실: "+(available.isEmpty()?"없음":String.join(", ",available))+" · 예약 전송 없음");return;
            }
            for(String room:plan.priorities()){for(int i=0;i<rooms.length();i++){JSONObject r=rooms.getJSONObject(i);if(room.equals(r.optString("name"))&&r.optBoolean("available")){selected=room;break;}}if(!selected.isEmpty())break;}
            if(selected.isEmpty()){finish("NO_ROOM","조건에 맞는 빈 객실이 없습니다.");return;}
            events.stage("PREPARING",(plan.demo()?"[모의] ":"")+selected+" · 객실 선택");
            eval("room",ignored->submit("reservation1.php"));
        }else if(page.equals("order_ok1.php")){
            if(phase!=1){fail();return;}phase=2;
            if(!plan.consent){finish("FAILED","약관·최종 제출 동의 없음");return;}
            eval("terms",ignored->submit("order_ok1.php"));
        }else if(page.equals("order_ok2.php")){
            if(phase!=2||finalSent){fail();return;}phase=3;
            if(!info.optBoolean("personal")){finish("FAILED","예약자 입력 화면을 확인하지 못했습니다.");return;}
            eval("fill",ignored->{Runnable finalAction=()->{try{
                if(ended)return;
                events.beforeFinal(); // Synchronously persisted BEFORE any final click, even if process dies.
                finalSent=true;events.stage("SUBMITTING",(plan.demo()?"[모의] ":"")+selected+" · 최종 제출 중 · 재전송 금지");
                submit("order_ok2.php");
            }catch(Exception e){finish("FAILED","최종 제출 전 저장·실행 조건 확인 실패 · 전송하지 않았습니다.");}};
                if(plan.demo()){events.stage("PREPARING","[모의] 입력 완료 · 12초 뒤 최종 제출 · 화면을 잠가도 엔진이 계속 실행됩니다.");main.postDelayed(finalAction,12000);}else finalAction.run();
            });
        }else if(page.equals("order_ok3.php")){
            if(phase!=3||!finalSent){fail();return;}phase=4;
        }else if(page.equals("order_ok4.php")){
            if(!finalSent||!info.optBoolean("receipt")){finish("CHECK_REQUIRED","완료 화면의 예약자·객실·입실일·박수 대조 실패 · 재제출하지 않습니다.");return;}
            finish("SUCCESS",(plan.demo()?"[모의] ":"")+selected+" · 완료 영수증 대조 성공");
        } // order_ok3 may use a site-owned redirect. Wait for order_ok4; never infer success from HTTP 200.
    }
    private void submit(String expected){if(ended)return;expectedPage=expected;eval("submit",ignored->{});}
    private String expectedPage="";
    interface Result {void done(JSONObject json);}
    private void eval(String op,Result result){
        if(ended||web==null)return;
        try {
            JSONObject input=plan.json().put("selectedRoom",selected).put("expectedPage",expectedPage);
            String script="(function(){try{"+helpers+";return JSON.stringify({ok:true,value:phoneStep("+JSONObject.quote(op)+","+input+")});}catch(e){return JSON.stringify({ok:false});}})()";
            web.evaluateJavascript(script,raw->{if(ended)return;try{
                Object decoded=new JSONTokener(raw).nextValue();if(!(decoded instanceof String))throw new JSONException("No result");
                JSONObject envelope=new JSONObject((String)decoded);if(!envelope.optBoolean("ok")){fail();return;}
                result.done(envelope.getJSONObject("value"));
            }catch(Exception e){fail();}});
        }catch(Exception e){fail();}
    }
    private void fail(){finish(finalSent?"CHECK_REQUIRED":"FAILED","사이트 화면 구조 또는 처리 단계가 맞지 않습니다. 안전하게 중지 · 자동 재제출 없음");}
    public void cancel(){if(batch!=null){batch.cancel();return;}if(camp!=null){camp.cancel();return;}if(!ended)finish(finalSent?"CHECK_REQUIRED":"STOPPED",finalSent?"제출 후 중지됨 · 예약 내역 확인 필요":"사용자가 중지했습니다.");}
    private void finish(String stage,String message){if(ended)return;ended=true;main.removeCallbacks(timeout);if(web!=null){web.stopLoading();web.destroy();web=null;}events.finished(stage,message);}
}
