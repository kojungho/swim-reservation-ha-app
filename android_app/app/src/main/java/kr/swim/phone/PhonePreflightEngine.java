package kr.swim.phone;
import android.annotation.SuppressLint;import android.content.Context;import android.net.Uri;import android.os.*;import android.webkit.*;import org.json.*;import java.io.*;import java.net.*;import java.nio.charset.StandardCharsets;import java.time.*;import java.util.*;import java.util.concurrent.*;
/** Native GET-only download + offline DOM verification. Website scripts, all
 * WebView networking and form submission are disabled; no reservation engine,
 * submit operation, identity POST, cookie mutation or booking-record writer. */
final class PhonePreflightEngine implements PhoneExecution {
 interface Transport {String get(String url)throws Exception;}
 static Transport testTransport; // Instrumentation only, never read from UI or storage.
 final Context context;final Plan original;final PreflightService.Result result;final Handler main=new Handler(Looper.getMainLooper());final ExecutorService io=Executors.newSingleThreadExecutor();final String helpers,userAgent;
 volatile HttpURLConnection connection;volatile boolean ended;WebView web;Plan trial;List<String> dates;int dateIndex,personIndex,site,generation;String operation="listing",loaded="",pendingHtml="";boolean parsing;
 PhonePreflightEngine(Context c,Plan plan,PreflightService.Result result)throws Exception{context=c;original=Plan.from(plan.json());this.result=result;helpers=PhoneEngine.asset(c,"camp-engine.js")+PhoneEngine.asset(c,"camp-step.js");userAgent=WebSettings.getDefaultUserAgent(c);}
 @Override @SuppressLint("SetJavaScriptEnabled") public void start(){
  web=new WebView(context);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setBlockNetworkLoads(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setDomStorageEnabled(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  web.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){if(r.isForMainFrame()&&"data".equals(r.getUrl().getScheme()))return null;return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Map.of(),new ByteArrayInputStream(new byte[0]));}
   @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !r.isForMainFrame()||!"data".equals(r.getUrl().getScheme());}
   @Override public void onPageFinished(WebView v,String url){if(ended||loaded.isEmpty()||parsing)return;int expected=generation;v.evaluateJavascript("document.body?.getAttribute('data-preflight')",token->{if(ended||parsing||expected!=generation||!JSONObject.quote(String.valueOf(expected)).equals(token))return;parsing=true;String html=pendingHtml;pendingHtml="";v.evaluateJavascript("(()=>{const d=new DOMParser().parseFromString("+JSONObject.quote(html)+",'text/html');d.querySelectorAll('script,iframe,object,embed,link,meta,base,style,svg,math').forEach(e=>e.remove());for(const e of d.querySelectorAll('*'))for(const a of [...e.attributes])if(/^on/i.test(a.name)||['src','srcset','style'].includes(a.name.toLowerCase()))e.removeAttribute(a.name);document.body.replaceChildren(...d.body.childNodes);document.addEventListener('submit',e=>e.preventDefault(),true);return true})()",raw->{if(!ended&&expected==generation)evaluate();});});}
   @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail detail){finish("failed","RENDERER",operation);return true;}
  });
  web.setWebChromeClient(new WebChromeClient(){@Override public boolean onJsAlert(WebView v,String u,String m,JsResult r){r.cancel();finish("failed","SCRIPT",operation);return true;}@Override public boolean onJsConfirm(WebView v,String u,String m,JsResult r){r.cancel();finish("failed","SCRIPT",operation);return true;}});
  dates=PreflightPolicy.dates(SiteClock.now(context),original.date);nextDate();
 }
 void nextDate(){if(ended)return;if(dateIndex>=dates.size()){finish("unavailable","NO_VACANCY","listing");return;}try{trial=Plan.from(original.json());trial.date=dates.get(dateIndex++);trial.nights=1;trial.mode="reserve";trial.trigger=0;trial.people=new JSONArray();operation="listing";load(SiteLinks.camp(trial,"",0));}catch(Exception e){finish("failed","PLAN","listing");}}
 void load(String url){if(ended)return;loaded="";io.execute(()->{try{
  String html=testTransport==null?download(url):testTransport.get(url);
  main.post(()->{if(ended)return;loaded=url;pendingHtml=html;parsing=false;generation++;
   // The first CSP cannot be relaxed by the fetched page. evaluateJavascript is
   // our own local helper, not an inline or downloaded site script.
   web.loadDataWithBaseURL(null,"<!doctype html><meta charset=\"UTF-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'\"><body data-preflight='"+generation+"'></body>","text/html","UTF-8",null);
  });
 }catch(Exception error){String code=error instanceof HttpFailure?"HTTP_"+((HttpFailure)error).status:"CONNECTION";main.post(()->finish("failed",code,operation));}});}
 static final class HttpFailure extends IOException {final int status;HttpFailure(int status){this.status=status;}}
 String download(String address)throws Exception{
  URI url=new URI(address);if(!"https".equals(url.getScheme())||!PhoneEngine.HOST.equals(url.getHost())||!Set.of("/camp/","/camp/book.php").contains(url.getPath()))throw new IOException();
  HttpURLConnection request=PhoneReads.open(address,"GET");connection=request;request.setRequestProperty("User-Agent",userAgent);
  try{if(ended)throw new IOException();int status=request.getResponseCode();if(status!=200)throw new HttpFailure(status);return PhoneReads.text(request);}finally{request.disconnect();connection=null;}
 }
 void evaluate(){if(ended)return;try{
  JSONObject input=trial.json().put("catalog",RoomCatalog.entries()).put("site",site).put("checkout",LocalDate.parse(trial.date).plusDays(1).toString());
  String op=operation.equals("preflight")?operation:"preflight-"+operation;
  web.evaluateJavascript("(()=>{try{"+helpers+";return JSON.stringify(campStep("+JSONObject.quote(op)+","+input+","+JSONObject.quote(loaded)+"))}catch(e){return JSON.stringify({ok:false,code:'DOM_ERROR'})}})()",raw->{if(ended)return;try{JSONObject r=new JSONObject((String)new JSONTokener(raw).nextValue());
   if(!r.optBoolean("ok")){finish("failed",r.optString("code","FORM_MISMATCH"),operation);return;}
   if(operation.equals("listing")){JSONArray available=r.getJSONArray("available");String name=null;for(int i=0;i<available.length()&&name==null;i++){int id=available.getInt(i);for(String known:RoomCatalog.NAMES)if(RoomCatalog.id(known)==id){site=id;name=known;break;}}if(name==null){nextDate();return;}trial.rooms=name;personIndex=0;nextPerson();}
   else if(operation.equals("prepare")){operation="preflight";evaluate();}
   else if(operation.equals("preflight")){personIndex++;nextPerson();}
  }catch(Exception e){finish("failed","DOM_ERROR",operation);}});
 }catch(Exception e){finish("failed","DOM_ERROR",operation);}}
 void nextPerson(){if(ended)return;try{
  int count=original.mode.equals("profiles-parallel")?original.people.length():1;if(count<1){finish("failed","PROFILE","prepare");return;}if(personIndex>=count){finish("passed","","preflight");return;}
  if(original.mode.equals("profiles-parallel")){JSONObject p=original.people.getJSONObject(personIndex);trial.name=p.getString("name");trial.phone=p.getString("phone");trial.payer=p.optString("payer");}
  operation="prepare";load(SiteLinks.camp(trial,"book.php",site));
 }catch(Exception e){finish("failed","PROFILE","prepare");}}
 void finish(String state,String code,String step){if(ended)return;cancel();result.done(state,code,step);}
 @Override public void cancel(){if(ended)return;ended=true;HttpURLConnection request=connection;if(request!=null)request.disconnect();io.shutdownNow();main.removeCallbacksAndMessages(null);if(web!=null){web.stopLoading();web.destroy();web=null;}}
}
