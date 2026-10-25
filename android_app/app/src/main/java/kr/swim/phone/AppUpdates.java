package kr.swim.phone;

import android.app.*;
import android.content.*;
import android.net.Uri;
import org.json.JSONObject;
import java.net.*;
import java.nio.charset.StandardCharsets;

/** Public version metadata only. No identity, HA token, plan or site cookies leave the phone. */
final class AppUpdates {
    static final String MANIFEST="https://raw.githubusercontent.com/kojungho/swim-reservation-ha-app/main/android_app/update.json";
    static void check(Activity activity,boolean manual){
        if(new LocalStore(activity).active()){if(manual)new AlertDialog.Builder(activity).setMessage("예약·대기 작업을 중지한 뒤 업데이트를 확인하세요.").setPositiveButton("확인",null).show();return;}
        android.content.SharedPreferences prefs=activity.getSharedPreferences("phone-update",0);
        if(!manual&&System.currentTimeMillis()-prefs.getLong("checked",0)<86400000)return;
        new Thread(()->{
            String message="업데이트 정보를 확인하지 못했습니다. 현재 앱은 그대로 사용할 수 있습니다.";JSONObject manifest=null;
            try{HttpURLConnection c=(HttpURLConnection)new URL(MANIFEST).openConnection();c.setConnectTimeout(8000);c.setReadTimeout(8000);c.setInstanceFollowRedirects(false);
                try{if(c.getResponseCode()!=200)throw new Exception();java.io.ByteArrayOutputStream buffer=new java.io.ByteArrayOutputStream();try(java.io.InputStream input=c.getInputStream()){byte[] chunk=new byte[2048];int count;while((count=input.read(chunk))!=-1){buffer.write(chunk,0,count);if(buffer.size()>16384)throw new Exception();}}manifest=new JSONObject(new String(buffer.toByteArray(),StandardCharsets.UTF_8));
                    if(!"kr.swim.phone".equals(manifest.getString("packageId")))throw new Exception();
                    URI uri=URI.create(manifest.getString("apkUrl"));if(!"https".equals(uri.getScheme())||!"github.com".equals(uri.getHost())||!uri.getPath().startsWith("/kojungho/swim-reservation-ha-app/releases/download/phone-")||!uri.getPath().endsWith(".apk")||uri.getUserInfo()!=null||uri.getQuery()!=null)throw new Exception();
                    prefs.edit().putLong("checked",System.currentTimeMillis()).apply();message=manifest.getInt("versionCode")>BuildConfig.VERSION_CODE?"새 앱 "+manifest.getString("versionName")+"이 있습니다. 다운로드 후 Android 설치 화면에서 직접 승인해 주세요. 진행 중인 예약은 중지한 후 업데이트하세요.":"최신 앱입니다 ("+BuildConfig.VERSION_NAME+").";
                }finally{c.disconnect();}
            }catch(Exception ignored){manifest=null;}
            JSONObject result=manifest;String text=message;activity.runOnUiThread(()->{if(activity.isFinishing()||activity.isDestroyed()||new LocalStore(activity).active())return;
                boolean newer=result!=null&&result.optInt("versionCode")>BuildConfig.VERSION_CODE;if(!manual&&!newer)return;
                AlertDialog.Builder d=new AlertDialog.Builder(activity).setTitle("앱 업데이트").setMessage(text).setNegativeButton("닫기",null);
                if(newer)d.setPositiveButton("APK 다운로드",(dialog,which)->{try{activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(result.optString("apkUrl"))));}catch(Exception ignored){}});d.show();
            });
        },"phone-version-check").start();
    }
}
