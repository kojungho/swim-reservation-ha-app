package kr.swim.phone;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.net.http.SslError;
import android.os.*;
import android.webkit.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.*;

/** Service-owned new-site engine. No native bridge on any remote document. */
final class CampPhoneEngine {
    final Context context;final Plan plan;final boolean lookup;final PhoneEngine.Events events;
    final Handler main=new Handler(Looper.getMainLooper());final String helpers;
    WebView web;boolean ended=false;volatile boolean submitted=false;int candidate=-1,site=0,openingReads=0;String processed="",recordId;
    final Runnable timeout=()->finish(submitted?"CHECK_REQUIRED":"FAILED","사이트 응답 시간 초과 · 자동 재제출 없음");
    CampPhoneEngine(Context c,Plan p,boolean lookup,PhoneEngine.Events events)throws IOException{context=c;plan=p;this.lookup=lookup;this.events=events;helpers=PhoneEngine.asset(c,"camp-engine.js")+PhoneEngine.asset(c,"camp-step.js");}
    volatile String paymentId;
    boolean returnedFromPayment;
    void checkoutVisible(boolean visible){
        if(ended||paymentId==null)return;
        main.removeCallbacks(timeout);
        if(!visible)main.postDelayed(timeout,15*60*1000L);
    }
    boolean showPaymentDialog(WebView view,String message,JsResult result,boolean confirm){
        PaymentActivity activity=PaymentActivity.visible(view);
        if(paymentId==null||activity==null)return false;
        android.app.AlertDialog.Builder dialog=new android.app.AlertDialog.Builder(activity)
            .setTitle("결제 페이지 안내").setMessage(message)
            .setPositiveButton("확인",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel());
        if(confirm)dialog.setNegativeButton("취소",(d,w)->result.cancel());
        dialog.show();
        return true;
    }
    boolean card(){return plan.manualCard && !lookup && !plan.demo();}
    boolean processor(Uri uri){String host=uri.getHost();return "https".equals(uri.getScheme()) && uri.getUserInfo()==null && (uri.getPort()==-1 || uri.getPort()==443) && host!=null && (host.equals("inicis.com") || host.endsWith(".inicis.com"));}
    boolean permitted(Uri uri,boolean top){
        if(allowed(uri,top,plan.demo()))return true;
        if(!card()||!submitted)return false;
        if(paymentBridge(uri)||processor(uri))return true;
        if(!top && "about:blank".equals(uri.toString()))return true;
        return paymentId!=null && "https".equals(uri.getScheme()) && uri.getUserInfo()==null;
    }
    boolean paymentBridge(Uri uri){
        return "https".equals(uri.getScheme()) && PhoneEngine.HOST.equals(uri.getHost())
            && uri.getUserInfo()==null && (uri.getPort()==-1||uri.getPort()==443)
            && "/camp/pay.php".equals(uri.getPath());
    }
    void prepareCard(){
        stage("공식 예약 폼 · 신용카드·필수 약관 확인");
        eval("card-prepare",r->{
            if(!r.optBoolean("ok")){fail(r);return;}
            try{events.beforeFinal();}catch(Exception e){finish("FAILED","미결제 주문 시작 상태 저장 실패");return;}
            submitted=true;
            stage("미결제 주문 요청 · 이니시스 이동 대기");
            eval("card-submit",result->{if(!result.optBoolean("ok"))fail(result);});
        });
    }
    String origin(){return "https://"+(plan.demo()?"demo.swim.invalid":PhoneEngine.HOST);}
    static boolean allowed(Uri u,boolean main,boolean demo){return "https".equals(u.getScheme())&&(demo?"demo.swim.invalid":PhoneEngine.HOST).equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&(!main||u.getPath()!=null&&u.getPath().matches("/camp/(book\\.php|done\\.php)?"));}
    String url(String page,int id){return SiteLinks.camp(plan,page,id).replace("https://"+PhoneEngine.HOST,origin());}
    void stage(String message){events.stage(submitted?"SUBMITTING":"PREPARING",(plan.demo()?"[모의] ":"")+message);}
    @SuppressLint("SetJavaScriptEnabled") void start(){
        web=new WebView(card()?new android.content.MutableContextWrapper(context):context);CookieManager cookies=PhoneSessions.attach(web,context);web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT,false);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(card());s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setCacheMode(WebSettings.LOAD_NO_CACHE);cookies.setAcceptThirdPartyCookies(web,card());
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsAlert(WebView v,String u,String message,JsResult r){if(showPaymentDialog(v,message,r,false))return true;r.cancel();finish(submitted?"CHECK_REQUIRED":"FAILED","사이트 추가 안내 · 공식 예약 내역 확인 필요");return true;}
            @Override public boolean onJsConfirm(WebView v,String u,String message,JsResult r){if(showPaymentDialog(v,message,r,true))return true;r.cancel();finish(submitted?"CHECK_REQUIRED":"FAILED","사이트 추가 확인창 · 자동 승인하지 않습니다.");return true;}
        });
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                if(!permitted(r.getUrl(),r.isForMainFrame()))return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Map.of(),new ByteArrayInputStream(new byte[0]));
                if(!plan.demo())return null;
                if(!r.isForMainFrame())return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
                try{PhoneEngine.demoDocumentRequests++;String path=r.getUrl().getPath();
                    if((PhoneEngine.demoScenario.equals("camp-429")&&path.equals("/camp/done.php"))||(PhoneEngine.demoScenario.equals("camp-opening-429")&&path.equals("/camp/book.php")))return new WebResourceResponse("text/html","UTF-8",429,"Too Many Requests",Map.of(),new ByteArrayInputStream(new byte[0]));
                    String name=path.endsWith("book.php")?"book":path.endsWith("done.php")?"done":"listing";
                    String html=PhoneEngine.asset(context,"demo/camp-"+name+".html").replace("DEMO_DATE",plan.date).replace("DEMO_CHECKOUT",LocalDate.parse(plan.date).plusDays(plan.nights).toString()).replace("DEMO_SITE",String.valueOf(RoomCatalog.id(plan.priorities().get(0)))).replace("DEMO_NAME",plan.name).replace("DEMO_ROOM",RoomCatalog.NAMES.get(RoomCatalog.NAMES.indexOf(plan.priorities().get(0))).split("_")[1]+plan.priorities().get(0).split("_")[0]).replace("DEMO_NIGHTS",plan.nights+"박");
                    if(PhoneEngine.demoScenario.equals("camp-wrong-date")&&name.equals("book"))html=html.replace("name=\"checkin\" value=\""+plan.date+"\"","name=\"checkin\" value=\"2000-01-01\"");
                    if((PhoneEngine.demoScenario.equals("camp-not-open")||PhoneEngine.demoScenario.equals("camp-opens-second")&&PhoneEngine.demoDocumentRequests==1)&&name.equals("book"))html="<div class='msg-box'>12.31 체크인까지 예약 가능합니다.</div>";
                    if(PhoneEngine.demoScenario.equals("camp-wrong-receipt")&&name.equals("done"))html=html.replace(plan.date,"2000-01-01");
                    return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                }catch(Exception e){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){
                Uri uri=r.getUrl();
                if(permitted(uri,r.isForMainFrame()))return false;
                if(paymentId!=null){
                    PaymentActivity activity=PaymentActivity.visible(v);
                    if(activity!=null)CardAppLaunch.offer(activity,uri);
                    return true;
                }
                if(!r.isForMainFrame())return true;
                String host=uri.getHost();
                String destination=host!=null && host.matches("[A-Za-z0-9.-]{1,200}")?host:"외부 앱";
                finish(submitted?"CHECK_REQUIRED":"FAILED","이동을 확인할 수 없습니다 · "+destination);
                return true;
            }
            @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse response){if(r.isForMainFrame())finish(submitted?"CHECK_REQUIRED":"FAILED","HTTP "+response.getStatusCode()+" · 자동 재시도·재제출 없음");}
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame())finish(submitted?"CHECK_REQUIRED":"FAILED","네트워크·페이지 오류 · 자동 재제출 없음");}
            @Override public void onReceivedSslError(WebView v,SslErrorHandler h,SslError e){h.cancel();finish(submitted?"CHECK_REQUIRED":"FAILED","인증서 검증 실패 · 중지");}
            @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){finish(submitted?"CHECK_REQUIRED":"FAILED","예약 화면 프로세스 종료 · 자동 재제출 없음");return true;}
            @Override public void onPageFinished(WebView v,String address){if(ended)return;
                if(card()&&submitted){
                    if(paymentId==null && (processor(Uri.parse(address)) || paymentBridge(Uri.parse(address))) && address.equals(v.getUrl())){
                        main.removeCallbacks(timeout);
                        paymentId=PaymentActivity.register(CampPhoneEngine.this);
                        events.stage("SUBMITTING","결제 대기 중 · 공식 결제창에서 직접 진행");
                        main.postDelayed(timeout,15*60*1000L);
                    }
                    if(!returnedFromPayment && paymentId!=null && allowed(Uri.parse(address),true,false)
                        && "/camp/done.php".equals(Uri.parse(address).getPath())){
                        returnedFromPayment=true;
                        events.stage("SUBMITTING","결제 후 공식 예약 결과 화면 · 내용을 확인하세요.");
                    }
                    return;
                }
                if(address.equals(processed)||!allowed(Uri.parse(address),true,plan.demo()))return;processed=address;main.removeCallbacks(timeout);main.postDelayed(timeout,30000);String path=Uri.parse(address).getPath();if(path.equals("/camp/"))listing();else if(path.endsWith("book.php")){if(card())prepareCard();else prepare();}else if(path.endsWith("done.php"))receipt();}
        });
        main.postDelayed(timeout,30000);stage("브라우저 준비 · 새 공식 사이트");
        cookies.removeAllCookies(done->{if(ended)return;openListing();});
    }
    void next(){if(ended||submitted)return;candidate++;if(candidate>=plan.priorities().size()){finish("NO_ROOM","선택한 사이트에 예약 가능한 자리가 없습니다.");return;}site=RoomCatalog.id(plan.priorities().get(candidate));if(site<1){finish("FAILED","사이트 번호 확인 실패 · 자동 추정하지 않습니다.");return;}if(!liveSites.contains(site)){next();return;}stage("사이트명·최신 URL 확인 · 예약정보 화면 접속");openBookingPage();}
    final Set<Integer> liveSites=new HashSet<>();
    void openListing(){if(ended||submitted)return;processed="";openingReads++;web.loadUrl(url("",0));}
    boolean retryOpening(JSONObject r,Runnable retry){long delay=OpeningReadiness.retryDelay(submitted,r.optString("code"),openingReads,plan.trigger,SiteClock.now(context));if(delay<0)return false;stage("오픈 반영 대기 · 재조회 ("+(openingReads+1)+"/5)");main.postDelayed(()->{if(ended||submitted)return;if(!OpeningReadiness.retryAllowed(submitted,r.optString("code"),openingReads,plan.trigger,SiteClock.now(context))){fail(r);return;}retry.run();},delay);return true;}
    void openBookingPage(){if(ended||submitted)return;processed="";openingReads++;web.loadUrl(url("book.php",site));}
    void listing(){stage("사이트명·최신 URL·빈자리·기간 대조");eval("listing",r->{if(!r.optBoolean("ok")){if(!lookup&&retryOpening(r,this::openListing))return;fail(r);return;}try{RoomCatalog.merge(context,r.getJSONArray("catalog"),true);}catch(Exception e){finish("FAILED","사이트 목록 중복·형식 불일치 · 중지");return;}JSONArray ids=r.optJSONArray("available");liveSites.clear();for(int i=0;ids!=null&&i<ids.length();i++)liveSites.add(ids.optInt(i));if(lookup){new LocalStore(context).availability(plan,liveSites,true);finish("INSPECTED","예약 가능 사이트 "+liveSites.size()+"개 · 예약 전송 없음");return;}next();});}
    void prepare(){if(submitted){finish("CHECK_REQUIRED","제출 후 입력 화면 복귀 · 재제출 없음");return;}stage("폼·보안값·사이트·기간 검증 및 정보·필수 약관 일괄 입력");eval("prepare",r->{if(!r.optBoolean("ok")){long delay=OpeningReadiness.retryDelay(submitted,r.optString("code"),openingReads,plan.trigger,SiteClock.now(context));if(delay>=0){stage("오픈 반영 대기 · "+delay/1000+"초 후 재조회 ("+(openingReads+1)+"/5)");main.postDelayed(()->{if(ended||submitted)return;if(!OpeningReadiness.retryAllowed(submitted,r.optString("code"),openingReads,plan.trigger,SiteClock.now(context))){fail(r);return;}openBookingPage();},delay);}else if("NO_ROOM".equals(r.optString("code")))next();else fail(r);return;}stage("입력값·무통장·필수 약관 검증 완료");
        Runnable send=()->{if(ended)return;eval("capture",captured->{if(!captured.optBoolean("ok")){fail(captured);return;}try{
            if(!plan.consent)throw new IllegalStateException();
            if(!plan.demo())recordId=new BookingRecords(context).begin(plan,RoomCatalog.NAMES.get(RoomCatalog.NAMES.indexOf(plan.priorities().get(candidate))),captured.getJSONObject("entered"));
            events.beforeFinal();submitted=true;stage("제출 직전 재검증 · 최종 클릭 1회");
            eval("submit",result->{if(!result.optBoolean("ok"))fail(result);});
        }catch(Exception error){if(!submitted&&recordId!=null)try{new BookingRecords(context).delete(recordId);}catch(Exception ignored){}finish("FAILED","예약 기록 저장·제출 준비 실패 · 전송하지 않았습니다.");}});};
        if(plan.demo()){stage("입력 완료 · 12초 뒤 모의 제출");main.postDelayed(send,12000);}else send.run();});}
    void receipt(){if(!submitted){finish("FAILED","제출 없는 완료 화면 · 성공으로 판단하지 않습니다.");return;}stage("영수증 예약번호·예약자·사이트·기간·입금대기 대조");eval("receipt",r->{if(!r.optBoolean("ok")){fail(r);return;}String message="예약 신청 완료 · 신청 당시 입금 대기 · 현재 상태는 예약 내역을 조회해 확인하세요.";if(recordId!=null)try{new BookingRecords(context).complete(recordId,r.getJSONObject("receipt"));}catch(Exception error){message+=" 제출 기록의 완료 표시 갱신 실패 · 입력 정보로 조회해 주세요.";}finish("SUCCESS",message);});}
    interface Result{void done(JSONObject value);}
    void eval(String op,Result result){if(ended)return;try{JSONObject input=plan.json().put("catalog",RoomCatalog.entries()).put("site",site).put("checkout",LocalDate.parse(plan.date).plusDays(plan.nights).toString());web.evaluateJavascript("(function(){try{"+helpers+";return JSON.stringify(campStep("+JSONObject.quote(op)+","+input+"));}catch(e){return JSON.stringify({ok:false,code:'DOM_ERROR'});}})()",raw->{if(ended)return;try{Object decoded=new JSONTokener(raw).nextValue();result.done(new JSONObject((String)decoded));}catch(Exception e){finish(submitted?"CHECK_REQUIRED":"FAILED","화면 결과 해석 실패 · 재제출 없음");}});}catch(Exception e){finish(submitted?"CHECK_REQUIRED":"FAILED","실행 처리 실패 · 재제출 없음");}}
    void fail(JSONObject r){finish(submitted?"CHECK_REQUIRED":"FAILED",!submitted&&"PAYMENT_METHOD_UNRECOGNIZED".equals(r.optString("code"))?"무통장입금 방식을 확인하지 못해 최종 제출하지 않았습니다. 다른 결제로 전환하지 않습니다.":"검증 실패 · "+r.optString("code","RECEIPT_MISMATCH")+" · 공식 사이트 확인 필요 · 자동 재제출 없음");}
    void cancel(){finish(submitted?"CHECK_REQUIRED":"STOPPED","사용자가 중지했습니다. 제출 후에는 예약 내역을 확인하세요.");}
    void finish(String state,String message){if(ended)return;ended=true;if(lookup&&!state.equals("INSPECTED"))new LocalStore(context).availability(plan,Set.of(),false);main.removeCallbacksAndMessages(null);if(paymentId!=null)PaymentActivity.remove(paymentId);if(web!=null){if(web.getParent() instanceof android.view.ViewGroup)((android.view.ViewGroup)web.getParent()).removeView(web);web.stopLoading();web.destroy();web=null;}events.finished(state,message);}
}
