package kr.swim.phone;

import android.content.Context;
import android.graphics.BitmapFactory;
import android.util.AtomicFile;
import java.io.*;
import java.net.URI;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;
import okhttp3.*;

/** Anonymous display snapshots only. No HA credentials, cookies or booking API. */
final class HaDisplay {
 static final ExecutorService worker=Executors.newSingleThreadExecutor();
 static final AtomicBoolean busy=new AtomicBoolean();
 static final AtomicBoolean reconnectPending=new AtomicBoolean();
 static volatile long lastAttempt=0;
 static long lastReconnect=0;
 static volatile String message="공개 화면 설정 확인 대기";
 static final int MAX_PHOTO=12*1024*1024;
 static final OkHttpClient client=new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(8,TimeUnit.SECONDS).readTimeout(15,TimeUnit.SECONDS).callTimeout(25,TimeUnit.SECONDS).build();
 static String origin(String value){
  try{URI u=new URI(value.trim());if(!"https".equalsIgnoreCase(u.getScheme())||u.getHost()==null||u.getRawUserInfo()!=null||u.getRawQuery()!=null||u.getRawFragment()!=null||!(u.getPath().isEmpty()||u.getPath().equals("/")))throw new Exception();return "https://"+u.getRawAuthority();}
  catch(Exception e){throw new IllegalArgumentException("HTTPS 서버 주소만 허용합니다.");}
 }
 static LocalStore vault(Context c){return new LocalStore(c,0);}
 static String digest(byte[] bytes)throws Exception{StringBuilder hex=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))hex.append(String.format(Locale.ROOT,"%02x",b&255));return hex.toString();}
 static JSONObject status(Context c)throws Exception{return new JSONObject().put("cached",vault(c).loadDocument("ha-display")).put("message",message).put("busy",busy.get());}
 static File photo(Context c)throws Exception{JSONObject cached=vault(c).loadDocument("ha-display");if(cached==null)throw new IOException();String hash=cached.getString("photoSha256");if(!hash.matches("[a-f0-9]{64}"))throw new IOException();return new File(c.getFilesDir(),"ha-display-"+hash+".png");}
 static byte[] body(Response response,int max)throws Exception{
  if(!response.isSuccessful()||response.body()==null)throw new IOException("HTTP "+response.code());
  if(response.body().contentLength()>max)throw new IOException("응답 크기 초과");
  try(InputStream in=response.body().byteStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>max)throw new IOException("응답 크기 초과");out.write(b,0,n);}return out.toByteArray();}
 }
 static JSONObject project(JSONObject display)throws Exception{
  if(display.optInt("schema")!=1||display.optJSONObject("settings")==null||!display.optString("photoSha256").matches("[a-f0-9]{64}"))throw new IOException("공개 설정 형식 불일치");
  JSONObject source=display.getJSONObject("settings"),settings=new JSONObject();
  JSONObject menus=source.optJSONObject("appMenus"),safeMenus=new JSONObject(),labels=source.optJSONObject("appMenuLabels"),safeLabels=new JSONObject();
  for(String mode:new String[]{"priority","multiple","profiles-parallel","watch"}){
   if(menus!=null&&menus.opt(mode) instanceof Boolean)safeMenus.put(mode,menus.getBoolean(mode));
   if(labels!=null&&labels.opt(mode) instanceof String){String label=labels.getString(mode).trim();if(!label.isEmpty()&&label.length()<=40&&!label.matches(".*[\\p{Cntrl}].*"))safeLabels.put(mode,label);}
  }
  settings.put("appMenus",safeMenus).put("appMenuLabels",safeLabels);
  JSONObject fonts=source.optJSONObject("fonts"),safeFonts=new JSONObject();
  for(String key:new String[]{"title","heading","body","field","button","room","status","calendar","list","log"})if(fonts!=null&&fonts.opt(key) instanceof Number){double n=fonts.getDouble(key);if(n==Math.rint(n)&&n>=10&&n<=(key.equals("title")?42:24))safeFonts.put(key,(int)n);}
  settings.put("fonts",safeFonts);
  for(String key:new String[]{"serverTime","watchInfo","stayRange","mapIcon"})if(source.opt(key) instanceof Boolean)settings.put(key,source.getBoolean(key));
  for(String key:new String[]{"menuCorner","mapCorner"})if(List.of("top-left","top-right","bottom-left","bottom-right").contains(source.optString(key)))settings.put(key,source.getString(key));
  for(String key:new String[]{"menuSpacing","floatingSize","dateInputVersion"})if(source.opt(key) instanceof Number){double n=source.getDouble(key);int min=key.equals("floatingSize")?44:0,max=key.equals("floatingSize")?64:key.equals("menuSpacing")?16:1;if(n==Math.rint(n)&&n>=min&&n<=max)settings.put(key,(int)n);}
  Object interval=display.opt("submitIntervalSeconds");
  if(!(interval instanceof Number)||((Number)interval).doubleValue()!=Math.rint(((Number)interval).doubleValue())||((Number)interval).doubleValue()<0||((Number)interval).doubleValue()>60)throw new IOException("제출 간격 불일치");
  return new JSONObject().put("settings",settings).put("photoSha256",display.getString("photoSha256")).put("submitIntervalSeconds",((Number)interval).intValue());
 }
 static byte[] get(String url,int max)throws Exception{
  // No cookies/auth headers/redirects. Public data cannot choose another URL.
  try(Response r=client.newCall(new Request.Builder().url(url).get().build()).execute()){return body(r,max);}
 }
 static void sync(Context c,boolean force){
  if((!force&&System.currentTimeMillis()-lastAttempt<60000)||!busy.compareAndSet(false,true))return;lastAttempt=System.currentTimeMillis();
  worker.execute(()->{boolean success=false;try{refresh(c,origin(BuildConfig.DEFAULT_HA_URL));message="앱 화면 설정 동기화 완료";success=true;}
   catch(Exception error){message="공개 설정 연결 대기 · 마지막 설정 유지";}finally{busy.set(false);if(reconnectPending.getAndSet(false)&&!success)sync(c,true);}});
 }
 static synchronized void reconnect(Context c){if(busy.get()){reconnectPending.set(true);return;}long now=android.os.SystemClock.elapsedRealtime();if(lastReconnect>0&&now-lastReconnect<3000)return;lastReconnect=now;sync(c.getApplicationContext(),true);}
 static void refresh(Context c,String base)throws Exception{
  JSONObject display=project(new JSONObject(new String(get(base+"/api/swim_phone/display",131072),java.nio.charset.StandardCharsets.UTF_8)));
  String hash=display.getString("photoSha256");File file=new File(c.getFilesDir(),"ha-display-"+hash+".png");
  if(!file.isFile()||!digest(readPhoto(file)).equals(hash)){
   byte[] image=get(base+"/api/swim_phone/map",MAX_PHOTO);
   if(!digest(image).equals(hash))throw new IOException("사진 변경 중 · 다음 동기화 대기");
   BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(image,0,image.length,bounds);if(bounds.outWidth<1||bounds.outHeight<1||bounds.outWidth>2400||bounds.outHeight>2400)throw new IOException("사진 형식 불일치");
   AtomicFile target=new AtomicFile(file);FileOutputStream out=target.startWrite();try{out.write(image);target.finishWrite(out);}catch(Exception e){target.failWrite(out);throw e;}
  }
  display.put("hasPhoto",true).put("updatedAt",System.currentTimeMillis());vault(c).saveDocument("ha-display",display);
  File[] files=c.getFilesDir().listFiles();if(files!=null)for(File previous:files)if(previous.getName().matches("ha-display-[a-f0-9]{64}\\.png")&&!previous.equals(file))previous.delete();
 }
 static byte[] readPhoto(File file)throws Exception{if(file.length()>MAX_PHOTO)throw new IOException();try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1){if(out.size()+n>MAX_PHOTO)throw new IOException();out.write(bytes,0,n);}return out.toByteArray();}}
}
