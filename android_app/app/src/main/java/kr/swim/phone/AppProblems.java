package kr.swim.phone;
import android.content.*;import android.net.*;import org.json.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import okhttp3.*;
/** Minimal anonymous diagnostics outbox; never accepts raw messages/identity,
 * reservation IDs, plans, HTTP bodies or credentials. Separate encrypted store. */
final class AppProblems {
 static final Set<String> CODES=Set.of("PAYMENT_METHOD_UNRECOGNIZED FORM_FIELDS_UNRECOGNIZED FORM_FIELDS_AMBIGUOUS FORM_VALIDATION_FAILED FORM_DOM_ERROR TERMS_UNRECOGNIZED FORM_MISMATCH FORM_UNRECOGNIZED LIST_UNRECOGNIZED CATALOG_MISMATCH PRE_SUBMIT_MISMATCH PREFLIGHT_SOURCE DOM_ERROR NOT_OPEN NO_ROOM NO_VACANCY PROFILE PLAN CONNECTION RENDERER SCRIPT TIMEOUT INTERRUPTED BACKGROUND_START CHECK_FAILED STOPPED BUSY EXECUTION_FAILED CHECK_REQUIRED HTTP_403 HTTP_429 HTTP_OTHER".split(" "));
 static final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();static final AtomicBoolean busy=new AtomicBoolean(),retry=new AtomicBoolean();static boolean observing;
 static boolean testPaused=false; // JVM tests only; never read from remote settings.
 static JSONObject load(Context c)throws Exception{JSONObject saved=new LocalStore(c,0).loadDocument("app-problems");if(saved==null)saved=new JSONObject().put("clientId",UUID.randomUUID().toString()).put("pending",new JSONArray());return saved;}
 static synchronized void enqueue(Context c,String category,String state,String code,String stage){try{
  if(!Set.of("preflight","execution").contains(category)||!Set.of("failed","unavailable","check_required").contains(state))return;
  if(!CODES.contains(code))code=code.matches("HTTP_[0-9]{3}")?"HTTP_OTHER":"CHECK_FAILED";
  if(!Set.of("listing","prepare","preflight","execution","unknown").contains(stage))stage="unknown";
  JSONObject saved=load(c);JSONArray queue=saved.getJSONArray("pending");while(queue.length()>=100)queue.remove(0);
  queue.put(new JSONObject().put("id",UUID.randomUUID().toString()).put("clientId",saved.getString("clientId")).put("version",BuildConfig.VERSION_NAME).put("versionCode",BuildConfig.VERSION_CODE).put("category",category).put("state",state).put("code",code).put("stage",stage).put("occurredAt",System.currentTimeMillis()));
  new LocalStore(c,0).saveDocument("app-problems",saved);flush(c);
 }catch(Exception ignored){/* Reporting cannot fail or resubmit a reservation. */}}
 static synchronized JSONObject first(Context c)throws Exception{JSONArray queue=load(c).getJSONArray("pending");return queue.length()==0?null:new JSONObject(queue.getJSONObject(0).toString());}
 static synchronized void acknowledged(Context c,String id)throws Exception{JSONObject saved=load(c);JSONArray queue=saved.getJSONArray("pending");for(int i=queue.length()-1;i>=0;i--)if(id.equals(queue.getJSONObject(i).optString("id")))queue.remove(i);new LocalStore(c,0).saveDocument("app-problems",saved);}
 static synchronized void observe(Context c){if(observing||testPaused)return;try{ConnectivityManager manager=c.getSystemService(ConnectivityManager.class);manager.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback(){@Override public void onAvailable(Network network){flush(c);}@Override public void onCapabilitiesChanged(Network network,NetworkCapabilities caps){if(caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))flush(c);}});observing=true;}catch(Exception ignored){}}
 static void flush(Context c){if(testPaused)return;Context app=c.getApplicationContext();observe(app);if(!busy.compareAndSet(false,true))return;worker.execute(()->{boolean remaining=false;try{
  for(int i=0;i<20;i++){JSONObject entry=first(app);if(entry==null)break;send(entry,HaDisplay.origin(BuildConfig.DEFAULT_HA_URL));acknowledged(app,entry.getString("id"));}remaining=first(app)!=null;
 }catch(Exception error){remaining=true;}finally{busy.set(false);if(remaining&&retry.compareAndSet(false,true))worker.schedule(()->{retry.set(false);flush(app);},60000,TimeUnit.MILLISECONDS);}});}
 static void send(JSONObject event,String base)throws Exception{
  Request request=new Request.Builder().url(base+"/api/swim_phone/problem").post(RequestBody.create(event.toString(),MediaType.get("application/json; charset=utf-8"))).build();
  try(Response response=HaDisplay.client.newCall(request).execute()){JSONObject ack=new JSONObject(new String(HaDisplay.body(response,2048),java.nio.charset.StandardCharsets.UTF_8));if(!ack.optBoolean("ok")||!event.getString("id").equals(ack.optString("id")))throw new java.io.IOException();}
 }
}
