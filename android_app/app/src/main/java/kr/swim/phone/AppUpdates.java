package kr.swim.phone;

import android.app.*;
import android.content.*;
import android.net.Uri;
import org.json.JSONObject;
import java.net.*;
import java.nio.charset.StandardCharsets;

/** Foreground checks use public metadata only. Existing work is never interrupted. */
final class AppUpdates {
    static final String MANIFEST="https://raw.githubusercontent.com/kojungho/swim-reservation-ha-app/main/android_app/update.json";
    interface MetadataSource { JSONObject read()throws Exception; }
    static volatile MetadataSource source=AppUpdates::fetch; // Package-private instrumentation seam; not remotely configurable.
    final Activity activity;
    final ApkDownload download;
    volatile boolean foreground=false,destroyed=false,running=false;
    boolean manualPending=false;
    volatile AlertDialog dialog;
    AppUpdates(Activity activity){this.activity=activity;download=new ApkDownload(activity);}
    void resume(){foreground=true;if(!download.resume())check(false);}
    void pause(){foreground=false;download.pause();}
    void destroy(){destroyed=true;foreground=false;download.destroy();if(dialog!=null)dialog.dismiss();dialog=null;}
    static android.content.SharedPreferences preferences(Context c){return c.getSharedPreferences("phone-update",0);}
    static void requireSupported(Context c){
        if(preferences(c).getInt("minimum",0)>BuildConfig.VERSION_CODE)
            throw new IllegalStateException("예약 방식 호환성 변경으로 업데이트가 필요합니다. 설정 → 앱 업데이트 확인에서 설치한 뒤 새 예약을 실행하세요. 기존 예약·저장 정보는 삭제하지 않았습니다.");
    }
    static JSONObject validate(JSONObject manifest)throws Exception{
        if(!"kr.swim.phone".equals(manifest.getString("packageId")))throw new Exception("package");
        int version=manifest.getInt("versionCode"),minimum=manifest.optInt("minSupportedVersionCode",0);
        if(version<1||minimum<0||minimum>version||manifest.getString("versionName").length()>100)throw new Exception("version");
        URI uri=URI.create(manifest.getString("apkUrl"));
        if(!"https".equals(uri.getScheme())||!"github.com".equals(uri.getHost())||uri.getPort()!=-1||!uri.getPath().startsWith("/kojungho/swim-reservation-ha-app/releases/download/phone-")||!uri.getPath().endsWith(".apk")||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null)throw new Exception("url");
        return manifest;
    }
    static JSONObject fetch()throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(MANIFEST).openConnection();
        c.setConnectTimeout(8000);c.setReadTimeout(8000);c.setInstanceFollowRedirects(false);c.setUseCaches(false);c.setRequestProperty("Cache-Control","no-cache");
        try{
            if(c.getResponseCode()!=200)throw new Exception("http");
            java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream();
            try(java.io.InputStream input=c.getInputStream()){byte[] chunk=new byte[2048];int count;while((count=input.read(chunk))!=-1){buffer.write(chunk,0,count);if(buffer.size()>16384)throw new Exception("size");}}
            return new JSONObject(new String(buffer.toByteArray(),StandardCharsets.UTF_8));
        }finally{c.disconnect();}
    }
    void check(boolean manual){
        if(destroyed||!foreground||download.working)return;
        if(new LocalStore(activity).active()){
            if(manual)new AlertDialog.Builder(activity).setMessage("예약·대기 작업을 마친 뒤 업데이트를 확인하세요. 진행 중인 작업은 중단하지 않습니다.").setPositiveButton("확인",null).show();
            return;
        }
        if(dialog!=null&&dialog.isShowing())return;
        if(running){manualPending|=manual;return;}
        running=true;
        new Thread(()->{
            JSONObject metadata=null;
            try{metadata=validate(source.read());}catch(Exception ignored){}
            JSONObject result=metadata;
            activity.runOnUiThread(()->{
                running=false;boolean requested=manual||manualPending;manualPending=false;
                if(destroyed||activity.isFinishing()||activity.isDestroyed())return;
                if(result!=null)preferences(activity).edit().putInt("minimum",result.optInt("minSupportedVersionCode",0)).putLong("checked",System.currentTimeMillis()).apply();
                if(!foreground||new LocalStore(activity).active())return;
                boolean newer=result!=null&&result.optInt("versionCode")>BuildConfig.VERSION_CODE;
                boolean required=newer&&result.optInt("minSupportedVersionCode",0)>BuildConfig.VERSION_CODE;
                android.content.SharedPreferences prefs=preferences(activity);
                if(!requested&&(!newer||!required&&prefs.getInt("laterCode",0)==result.optInt("versionCode")&&System.currentTimeMillis()<prefs.getLong("laterUntil",0)))return;
                String message=result==null?"업데이트 정보를 확인하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.":!newer?"최신 앱입니다 ("+BuildConfig.VERSION_NAME+").":required?"예약 방식 호환성 변경으로 "+result.optString("versionName")+" 업데이트가 필요합니다. 새 실제 예약 실행만 제한하며 진행 중인 예약·조회·저장 정보는 유지합니다.":"새 앱 "+result.optString("versionName")+"이 있습니다. "+("design".equals(result.optString("changeType"))?"디자인 변경으로 기존 기능은 계속 사용할 수 있습니다.":"선택 업데이트이며 기존 앱을 계속 사용할 수 있습니다.")+" 나중에를 누르면 이 버전 안내를 24시간 미룹니다.";
                AlertDialog.Builder builder=new AlertDialog.Builder(activity).setTitle(required?"필수 호환성 업데이트":"앱 업데이트").setMessage(message);
                if(newer&&!required)builder.setNegativeButton("나중에",(d,w)->defer(result));
                else builder.setNegativeButton("닫기",null);
                if(newer)builder.setPositiveButton("다운로드 · 설치",(d,w)->download.start(result));
                dialog=builder.create();
                if(newer&&!required)dialog.setOnCancelListener(d->defer(result));
                dialog.setOnDismissListener(d->dialog=null);dialog.show();
            });
        },"phone-version-check").start();
    }
    void defer(JSONObject manifest){preferences(activity).edit().putInt("laterCode",manifest.optInt("versionCode")).putLong("laterUntil",System.currentTimeMillis()+86400000L).apply();}
}
