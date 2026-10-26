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
    WebView web;boolean ended=false,submitted=false;int candidate=-1,site=0,openingReads=0;String processed="";
    final Runnable timeout=()->finish(submitted?"CHECK_REQUIRED":"FAILED","사이트 응답 시간 초과 · 자동 재제출 없음");
    CampPhoneEngine(Context c,Plan p,boolean lookup,PhoneEngine.Events events)throws IOException{context=c;plan=p;this.lookup=lookup;this.events=events;helpers=PhoneEngine.asset(c,"camp-engine.js")+PhoneEngine.asset(c,"camp-step.js");}
    String origin(){return "https://"+(plan.demo()?"demo.swim.invalid":PhoneEngine.HOST);}
    static boolean allowed(Uri u,boolean main,boolean demo){return "https".equals(u.getScheme())&&(demo?"demo.swim.invalid":PhoneEngine.HOST).equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&(!main||u.getPath()!=null&&u.getPath().matches("/camp/(book\\.php|done\\.php)?"));}
    String url(String page,int id){return SiteLinks.camp(plan,page,id).replace("https://"+PhoneEngine.HOST,origin());}
    void stage(String message){events.stage(submitted?"SUBMITTING":"PREPARING",(plan.demo()?"[모의] ":"")+message);}
    @SuppressLint("SetJavaScriptEnabled") void start(){
        web=new WebView(context);CookieManager cookies=PhoneSessions.attach(web,context);web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT,false);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setCacheMode(WebSettings.LOAD_NO_CACHE);cookies.setAcceptThirdPartyCookies(web,false);
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsAlert(WebView v,String u,String message,JsResult r){r.cancel();finish(submitted?"CHECK_REQUIRED":"FAILED","사이트 추가 안내 · 공식 예약 내역 확인 필요");return true;}
            @Override public boolean onJsConfirm(WebView v,String u,String message,JsResult r){r.cancel();finish(submitted?"CHECK_REQUIRED":"FAILED","사이트 추가 확인창 · 자동 승인하지 않습니다.");return true;}
        });
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){
                if(!allowed(r.getUrl(),r.isForMainFrame(),plan.demo()))return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Map.of(),new ByteArrayInputStream(new byte[0]));
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
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){if(!allowed(r.getUrl(),true,plan.demo())){finish(submitted?"CHECK_REQUIRED":"FAILED","허용되지 않은 이동 · 중지");return true;}return false;}
            @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse response){if(r.isForMainFrame())finish(submitted?"CHECK_REQUIRED":"FAILED","HTTP "+response.getStatusCode()+" · 자동 재시도·재제출 없음");}
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame())finish(submitted?"CHECK_REQUIRED":"FAILED","네트워크·페이지 오류 · 자동 재제출 없음");}
            @Override public void onReceivedSslError(WebView v,SslErrorHandler h,SslError e){h.cancel();finish(submitted?"CHECK_REQUIRED":"FAILED","인증서 검증 실패 · 중지");}
            @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){finish(submitted?"CHECK_REQUIRED":"FAILED","예약 화면 프로세스 종료 · 자동 재제출 없음");return true;}
            @Override public void onPageFinished(WebView v,String address){if(ended||address.equals(processed)||!allowed(Uri.parse(address),true,plan.demo()))return;processed=address;main.removeCallbacks(timeout);main.postDelayed(timeout,30000);String path=Uri.parse(address).getPath();if(path.equals("/camp/"))listing();else if(path.endsWith("book.php"))prepare();else if(path.endsWith("done.php"))receipt();}
        });
        main.postDelayed(timeout,30000);stage("브라우저 준비 · 새 공식 사이트");
        cookies.removeAllCookies(done->{if(ended)return;if(lookup||plan.watch())web.loadUrl(url("",0));else next();});
    }
    void next(){if(ended||submitted)return;candidate++;if(candidate>=plan.priorities().size()){finish("NO_ROOM","선택한 사이트에 예약 가능한 자리가 없습니다.");return;}site=RoomCatalog.id(plan.priorities().get(candidate));if(site<1){finish("FAILED","사이트 번호 확인 실패 · 자동 추정하지 않습니다.");return;}stage("사이트 번호 확인 · 예약정보 화면 접속");openingReads=0;openBookingPage();}
    void openBookingPage(){if(ended||submitted)return;processed="";openingReads++;web.loadUrl(url("book.php",site));}
    void listing(){stage("빈자리 목록·기간 대조");eval("listing",r->{if(!r.optBoolean("ok")){fail(r);return;}try{RoomCatalog.merge(context,r.getJSONArray("catalog"),true);}catch(Exception e){finish("FAILED","사이트 목록 번호·이름 충돌 · 중지");return;}JSONArray ids=r.optJSONArray("available");Set<Integer> available=new HashSet<>();for(int i=0;ids!=null&&i<ids.length();i++)available.add(ids.optInt(i));if(lookup){new LocalStore(context).availability(plan,available,true);finish("INSPECTED","예약 가능 사이트 "+available.size()+"개 · 예약 전송 없음");return;}for(int i=0;i<plan.priorities().size();i++)if(available.contains(RoomCatalog.id(plan.priorities().get(i)))){candidate=i-1;next();return;}finish("NO_ROOM","선택한 사이트에 빈자리 없음");});}
    void prepare(){if(submitted){finish("CHECK_REQUIRED","제출 후 입력 화면 복귀 · 재제출 없음");return;}stage("폼·보안값·사이트·기간 검증 및 정보·필수 약관 일괄 입력");eval("prepare",r->{if(!r.optBoolean("ok")){long delay=OpeningReadiness.retryDelay(submitted,r.optString("code"),openingReads,plan.trigger,SiteClock.now(context));if(delay>=0){stage("오픈 반영 대기 · "+delay/1000+"초 후 재조회 ("+(openingReads+1)+"/5)");main.postDelayed(()->{if(ended||submitted)return;if(!OpeningReadiness.retryAllowed(submitted,r.optString("code"),openingReads,plan.trigger,SiteClock.now(context))){fail(r);return;}openBookingPage();},delay);}else if("NO_ROOM".equals(r.optString("code")))next();else fail(r);return;}stage("입력값·무통장·필수 약관 검증 완료");Runnable send=()->{if(ended)return;try{if(!plan.consent)throw new IllegalStateException();events.beforeFinal();submitted=true;stage("제출 직전 재검증 · 최종 클릭 1회");eval("submit",result->{if(!result.optBoolean("ok"))fail(result);});}catch(Exception e){finish("FAILED","제출 전 저장·동의 검증 실패 · 전송하지 않았습니다.");}};if(plan.demo()){stage("입력 완료 · 12초 뒤 모의 제출");main.postDelayed(send,12000);}else send.run();});}
    void receipt(){if(!submitted){finish("FAILED","제출 없는 완료 화면 · 성공으로 판단하지 않습니다.");return;}stage("영수증 예약번호·예약자·사이트·기간·입금대기 대조");eval("receipt",r->{if(!r.optBoolean("ok")){fail(r);return;}finish("SUCCESS","예약 신청 완료 · 신청 당시 입금 대기 · 현재 입금·취소 상태와 기한은 예약 내역을 조회해 확인하세요.");});}
    interface Result{void done(JSONObject value);}
    void eval(String op,Result result){if(ended)return;try{JSONObject input=plan.json().put("catalog",RoomCatalog.entries()).put("site",site).put("checkout",LocalDate.parse(plan.date).plusDays(plan.nights).toString());web.evaluateJavascript("(function(){try{"+helpers+";return JSON.stringify(campStep("+JSONObject.quote(op)+","+input+"));}catch(e){return JSON.stringify({ok:false,code:'DOM_ERROR'});}})()",raw->{if(ended)return;try{Object decoded=new JSONTokener(raw).nextValue();result.done(new JSONObject((String)decoded));}catch(Exception e){finish(submitted?"CHECK_REQUIRED":"FAILED","화면 결과 해석 실패 · 재제출 없음");}});}catch(Exception e){finish(submitted?"CHECK_REQUIRED":"FAILED","실행 처리 실패 · 재제출 없음");}}
    void fail(JSONObject r){finish(submitted?"CHECK_REQUIRED":"FAILED","검증 실패 · "+r.optString("code","RECEIPT_MISMATCH")+" · 공식 사이트 확인 필요 · 자동 재제출 없음");}
    void cancel(){finish(submitted?"CHECK_REQUIRED":"STOPPED","사용자가 중지했습니다. 제출 후에는 예약 내역을 확인하세요.");}
    void finish(String state,String message){if(ended)return;ended=true;if(lookup&&!state.equals("INSPECTED"))new LocalStore(context).availability(plan,Set.of(),false);main.removeCallbacksAndMessages(null);if(web!=null){web.stopLoading();web.destroy();web=null;}events.finished(state,message);}
}
