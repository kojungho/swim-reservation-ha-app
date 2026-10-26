package kr.swim.phone;

import android.content.Context;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.net.http.SslError;
import org.json.*;
import java.util.*;
import java.io.*;

/** Read-only lookup forms and their original detail-selection POSTs. Never a booking/cancel POST. */
final class CampLookup {
    static CampLookup active;
    final Context context;final JSONArray profiles;final LocalStore store;final Handler main=new Handler(Looper.getMainLooper());final String helpers;
    final JSONArray rows=new JSONArray(),errors=new JSONArray(),states=new JSONArray();JSONArray selections=new JSONArray(),personRows=new JSONArray();
    WebView web;int profileIndex=0,detailIndex=0,phase=0;boolean ended=false,moving=false;final String job=UUID.randomUUID().toString();
    final Runnable timeout=()->failure("조회 응답 시간 초과");
    CampLookup(Context c,JSONArray p)throws Exception{context=c.getApplicationContext();profiles=new JSONArray(p.toString());store=new LocalStore(context);helpers=PhoneEngine.asset(context,"camp-engine.js")+PhoneEngine.asset(context,"camp-lookup.js");}
    static void begin(Context c,JSONArray profiles)throws Exception{if(active!=null)throw new IllegalStateException("이미 예약 내역을 조회 중입니다.");if(!PhoneSessions.supported()&&PhoneRuns.executing(c))throw new IllegalStateException("예약 실행이 끝난 뒤 조회하세요. 대기 중에는 조회할 수 있습니다.");if(profiles.length()<1||profiles.length()>20)throw new IllegalArgumentException("조회할 예약자를 선택하세요.");for(int i=0;i<profiles.length();i++){JSONObject p=profiles.getJSONObject(i);if(p.optString("name").isBlank()||!p.optString("phone").matches("01[0-9]{8,9}"))throw new IllegalArgumentException("조회 예약자명·연락처를 확인하세요.");}active=new CampLookup(c,profiles);try{active.start();}catch(RuntimeException e){active.stop();throw e;}}
    static void cancel(){if(active!=null){try{active.store.saveDocument("lookup-result",new JSONObject().put("pending",false).put("cancelled",true).put("rows",active.rows).put("errors",active.errors).put("profiles",active.states).put("capturedAt",System.currentTimeMillis()));}catch(Exception ignored){}active.stop();}}
    static boolean allowed(Uri uri){return "https".equals(uri.getScheme())&&PhoneEngine.HOST.equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)&&"/camp/lookup.php".equals(uri.getPath())&&uri.getQuery()==null;}
    void save(boolean pending){try{store.saveDocument("lookup-result",new JSONObject().put("job",job).put("pending",pending).put("rows",rows).put("errors",errors).put("profiles",states).put("capturedAt",System.currentTimeMillis()));}catch(Exception e){stop();}}
    @android.annotation.SuppressLint("SetJavaScriptEnabled") void start(){if(ended)return;if(profileIndex>=profiles.length()){save(false);stop();return;}
        phase=0;moving=false;detailIndex=0;personRows=new JSONArray();selections=new JSONArray();save(true);web=new WebView(context);CookieManager cookies=PhoneSessions.attach(web,"swim-lookup");WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setDomStorageEnabled(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setCacheMode(WebSettings.LOAD_NO_CACHE);cookies.setAcceptThirdPartyCookies(web,false);
        web.setWebChromeClient(new WebChromeClient(){@Override public boolean onJsConfirm(WebView v,String u,String m,JsResult r){r.cancel();failure("예상하지 못한 조회 확인창");return true;}@Override public boolean onJsAlert(WebView v,String u,String m,JsResult r){r.cancel();failure("공식 사이트 안내 · 입력 정보를 확인해 주세요.");return true;}});
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){if(!allowed(r.getUrl())){failure("조회 경로 불일치");return true;}return false;}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){Uri u=r.getUrl();if(r.isForMainFrame()?allowed(u):"https".equals(u.getScheme())&&PhoneEngine.HOST.equals(u.getHost())){
                if(PhoneReads.testMode&&r.isForMainFrame())try{return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(mockHtml().getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(Exception e){return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(new byte[0]));}
                return null;}return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Map.of(),new ByteArrayInputStream(new byte[0]));}
            @Override public void onReceivedHttpError(WebView v,WebResourceRequest r,WebResourceResponse response){if(v==web&&r.isForMainFrame())failure("조회 HTTP "+response.getStatusCode()+" · 자동 재시도 없음");}
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError error){if(v==web&&r.isForMainFrame())failure("조회 네트워크 오류");}
            @Override public void onReceivedSslError(WebView v,SslErrorHandler handler,SslError error){handler.cancel();failure("조회 인증서 검증 실패");}
            @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){failure("조회 화면 프로세스 종료");return true;}
            @Override public void onPageFinished(WebView v,String url){if(ended||v!=web)return;if(!allowed(Uri.parse(url))){failure("조회 결과 주소 불일치");return;}main.removeCallbacks(timeout);main.postDelayed(timeout,25000);if(phase==0)input();else if(phase==1)parse(false);else if(phase==2)parse(true);}
        });
        main.postDelayed(timeout,25000);cookies.removeAllCookies(done->{if(!ended&&web!=null)web.loadUrl(SiteLinks.receipts().toString());});
    }
    JSONObject person(){return profiles.optJSONObject(profileIndex);}
    String mockHtml()throws Exception{
        if(phase==0)return "<form class='lookup-form' method='post' action='/camp/lookup.php'><input type='hidden' name='_csrf' value='fake'><input name='name' required><input name='phone' required><button type='submit'>조회하기</button></form>";
        if(person().optString("name").equals("내역없음"))return "<div class='done-wrap'><form class='lookup-form'><div class='form-error'>일치하는 예약이 없습니다. 예약자명·연락처를 확인해 주세요.</div></form></div>";
        if(phase==1){StringBuilder html=new StringBuilder("<div class='done-wrap'>");for(int i=0;i<2;i++)html.append("<form class='lookup-pick' method='post' action='/camp/lookup.php'><input type='hidden' name='_csrf' value='fake'><input type='hidden' name='name' value='").append(android.text.TextUtils.htmlEncode(person().getString("name"))).append("'><input type='hidden' name='phone' value='").append(person().getString("phone")).append("'><input type='hidden' name='pick' value='fake-").append(i).append("'><span>TEST123-A").append(i).append("</span><button type='submit'>자세히 보기</button></form>");return html.append("</div>").toString();}
        return PhoneEngine.asset(context,"demo/camp-done.html").replace("DEMO_NAME",android.text.TextUtils.htmlEncode(person().getString("name"))).replace("DEMO_ROOM","하늘존해").replace("DEMO_DATE","2026-12-22").replace("DEMO_CHECKOUT","2026-12-23").replace("DEMO_NIGHTS","1박").replace("TEST123-ABC","TEST123-A"+detailIndex);
    }
    void input(){phase=3;try{String name=JSONObject.quote(person().getString("name")),phone=JSONObject.quote(person().getString("phone"));
        evaluate("(()=>{const forms=document.querySelectorAll('form.lookup-form');if(forms.length!==1)return {ok:false};const f=forms[0],u=new URL(f.action);if(u.origin!==location.origin||u.pathname!=='/camp/lookup.php'||u.search||f.method.toLowerCase()!=='post'||!f.querySelector('[name=\"_csrf\"]')?.value)return {ok:false};const n=f.querySelector('[name=\"name\"]'),p=f.querySelector('[name=\"phone\"]'),buttons=f.querySelectorAll('button[type=\"submit\"]');if(!n||!p||buttons.length!==1||buttons[0].hasAttribute('formaction'))return {ok:false};n.value="+name+";p.value="+phone+";if(!f.checkValidity())return {ok:false};return {ok:true};})()",result->{if(!result.optBoolean("ok")){failure("조회 입력 폼·보안값 불일치");return;}phase=1;evaluate("(()=>{document.querySelector('form.lookup-form button[type=submit]').click();return {ok:true}})()",ignored->{});});
        }catch(Exception e){failure("조회 입력 검증 실패");}}
    void parse(boolean detail){phase=3;try{JSONObject arg=new JSONObject().put("expectedName",person().getString("name")).put("rooms",RoomCatalog.entries());
        evaluate("(()=>{const r=readCampReservations("+arg+");if(r.kind!=='unknown')return {ok:true,parsed:r};const picks=readCampLookupSelections({expectedName:"+JSONObject.quote(person().getString("name"))+",expectedPhone:"+JSONObject.quote(person().getString("phone"))+"});return {ok:Boolean(picks),selections:picks};})()",result->{
            if(!result.optBoolean("ok")){failure("조회 결과 검증 실패 · 0건으로 판단하지 않습니다.");return;}
            JSONObject parsed=result.optJSONObject("parsed");
            if(detail){JSONArray found=parsed==null?null:parsed.optJSONArray("rows");if(parsed==null||!"detail".equals(parsed.optString("kind"))||found==null||found.length()!=1){failure("개별 예약 상세 형식 불일치");return;}JSONObject row=found.optJSONObject(0);if(!detailIdMatches(selections.optJSONObject(detailIndex),row)){failure("개별 예약번호 불일치");return;}for(int i=0;i<personRows.length();i++)if(personRows.optJSONObject(i).optString("id").equals(row.optString("id"))){failure("개별 예약 중복 결과");return;}personRows.put(row);detailIndex++;nextDetail();return;}
            if(parsed!=null){String kind=parsed.optString("kind");if(!List.of("detail","list","empty").contains(kind)){failure("조회 결과 미확인");return;}personRows=parsed.optJSONArray("rows");completePerson();return;}
            selections=result.optJSONArray("selections");if(selections==null||selections.length()<1){failure("상세 조회 대상 미확인");return;}nextDetail();
        });
        }catch(Exception e){failure("조회 결과 처리 실패");}}
    static boolean detailIdMatches(JSONObject selection,JSONObject row){
        if(selection==null||row==null||row.isNull("id")||row.optString("id").isEmpty())return false;
        return selection.isNull("id")||selection.optString("id").isEmpty()||selection.optString("id").equals(row.optString("id"));
    }
    void nextDetail(){if(ended)return;if(detailIndex>=selections.length()){completePerson();return;}
        Runnable send=()->{if(ended)return;phase=2;JSONObject fields=selections.optJSONObject(detailIndex).optJSONObject("fields");evaluate("(()=>{const fields="+fields+";const f=document.createElement('form');f.method='post';f.action='/camp/lookup.php';for(const [name,value]of Object.entries(fields)){const i=document.createElement('input');i.type='hidden';i.name=name;i.value=value;f.append(i);}document.body.append(f);f.submit();return {ok:true}})()",ignored->{});};
        if(detailIndex>0)main.postDelayed(send,1000);else send.run();
    }
    void completePerson(){try{for(int i=0;i<personRows.length();i++)rows.put(personRows.getJSONObject(i).put("profileIndex",profileIndex));states.put(new JSONObject().put("label",mask(person().getString("name"))).put("profileIndex",profileIndex).put("count",personRows.length()).put("ok",true));}catch(Exception e){failure("조회 정리 실패");return;}advance();}
    static String mask(String value){return value.length()<2?"*":value.substring(0,1)+"*"+(value.length()>2?value.substring(value.length()-1):"");}
    void failure(String message){if(ended||moving)return;try{errors.put(new JSONObject().put("profileIndex",profileIndex).put("message",message));states.put(new JSONObject().put("label",mask(person().optString("name"))).put("profileIndex",profileIndex).put("ok",false));}catch(Exception ignored){}advance();}
    void advance(){if(moving)return;moving=true;phase=3;main.removeCallbacksAndMessages(null);if(web!=null){WebView old=web;web=null;old.stopLoading();old.destroy();}profileIndex++;save(profileIndex<profiles.length());main.postDelayed(this::start,300);}
    interface Result{void done(JSONObject result);}
    void evaluate(String code,Result result){if(ended||web==null)return;WebView current=web;web.evaluateJavascript("(function(){try{"+helpers+";return JSON.stringify("+code+");}catch(e){return JSON.stringify({ok:false})}})()",raw->{if(ended||current!=web)return;try{result.done(new JSONObject((String)new JSONTokener(raw).nextValue()));}catch(Exception e){failure("조회 화면 구조 불일치");}});}
    void stop(){ended=true;main.removeCallbacksAndMessages(null);if(web!=null){web.stopLoading();web.destroy();web=null;}if(active==this)active=null;}
}
