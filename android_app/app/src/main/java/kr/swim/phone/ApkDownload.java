package kr.swim.phone;

import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.os.Build;
import android.provider.Settings;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;

/** App-owned download: no browser, external storage, silent installs or unverified APKs. */
final class ApkDownload {
    final Activity activity;
    volatile boolean cancelled,working;
    boolean waitingPermission,foreground=true,installPending;
    File ready;
    AlertDialog progress;
    ApkDownload(Activity activity){this.activity=activity;}
    static boolean allowed(URL url){return "https".equals(url.getProtocol())&&url.getUserInfo()==null&&(url.getPort()==-1||url.getPort()==443)&&Set.of("github.com","release-assets.githubusercontent.com","objects.githubusercontent.com").contains(url.getHost());}
    static void verify(Context context,File file,JSONObject manifest)throws Exception{
        if(manifest.has("sha256")){
            String expected=manifest.getString("sha256");if(!expected.matches("[0-9a-fA-F]{64}"))throw new IOException("Invalid digest");
            MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] bytes=new byte[32768];int n;while((n=input.read(bytes))!=-1)digest.update(bytes,0,n);}
            StringBuilder hash=new StringBuilder();for(byte b:digest.digest())hash.append(String.format("%02x",b&255));if(!expected.equalsIgnoreCase(hash.toString()))throw new IOException("Digest mismatch");
        }
        PackageManager pm=context.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo archive=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags),installed=pm.getPackageInfo(context.getPackageName(),flags);
        if(archive==null||!context.getPackageName().equals(archive.packageName)||version(archive)!=manifest.getInt("versionCode")||version(archive)<=BuildConfig.VERSION_CODE)throw new IOException("Package/version mismatch");
        android.content.pm.Signature[] a=Build.VERSION.SDK_INT>=28?archive.signingInfo.getApkContentsSigners():archive.signatures,b=Build.VERSION.SDK_INT>=28?installed.signingInfo.getApkContentsSigners():installed.signatures;
        if(a==null||b==null||a.length==0||a.length!=b.length)throw new IOException("Signer missing");
        Set<String> actual=new HashSet<>(),expected=new HashSet<>();for(var s:a)actual.add(s.toCharsString());for(var s:b)expected.add(s.toCharsString());if(!actual.equals(expected))throw new IOException("Signer mismatch");
    }
    static long version(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
    void start(JSONObject manifest){
        if(working||new LocalStore(activity).active())return;
        cancelled=false;working=true;ready=null;
        progress=new AlertDialog.Builder(activity).setTitle("앱 업데이트 다운로드").setMessage("연결 중… 앱 안에서 다운로드합니다.").setNegativeButton("취소",(d,w)->cancelled=true).setCancelable(false).create();progress.show();
        new Thread(()->{
            File part=new File(activity.getCacheDir(),"update-download.part");HttpURLConnection connection=null;
            try{
                AppUpdates.validate(manifest);URL url=new URL(manifest.getString("apkUrl"));
                for(int redirect=0;;redirect++){
                    if(cancelled)throw new InterruptedIOException();if(!allowed(url)||redirect>5)throw new IOException("Unsafe redirect");
                    connection=(HttpURLConnection)url.openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(15000);connection.setUseCaches(false);
                    int code=connection.getResponseCode();if(code>=300&&code<400){String location=connection.getHeaderField("Location");if(location==null)throw new IOException("Missing redirect");url=new URL(url,location);connection.disconnect();continue;}
                    if(code!=200)throw new IOException("HTTP "+code);break;
                }
                long total=connection.getContentLengthLong(),received=0,last=0;if(total>50*1024*1024)throw new IOException("APK too large");
                try(InputStream in=connection.getInputStream();FileOutputStream out=new FileOutputStream(part)){
                    byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1){if(cancelled)throw new InterruptedIOException();received+=n;if(received>50*1024*1024)throw new IOException("APK too large");out.write(buffer,0,n);
                        if(System.currentTimeMillis()-last>200){last=System.currentTimeMillis();long count=received;activity.runOnUiThread(()->{if(progress!=null)progress.setMessage(String.format(Locale.KOREA,"%.2f MB%s",count/1048576.0,total>0?String.format(Locale.KOREA," / %.2f MB",total/1048576.0):""));});}}
                    out.getFD().sync();
                }
                if(total>=0&&received!=total||received==0)throw new IOException("Incomplete APK");if(cancelled)throw new InterruptedIOException();
                verify(activity,part,manifest);File verified=UpdateApkProvider.file(activity);if(verified.exists()&&!verified.delete()||!part.renameTo(verified))throw new IOException("Cannot store APK");ready=verified;installPending=true;
                activity.runOnUiThread(()->{finishProgress();if(!cancelled&&foreground&&!activity.isDestroyed())install();});
            }catch(Exception error){part.delete();activity.runOnUiThread(()->{finishProgress();if(!cancelled&&!activity.isDestroyed())new AlertDialog.Builder(activity).setTitle("업데이트 다운로드 실패").setMessage("다운로드 또는 앱 검증을 완료하지 못했습니다. 네트워크를 확인하고 다시 시도하세요. 기존 앱과 저장 정보는 유지됩니다.").setPositiveButton("확인",null).show();});}
            finally{if(connection!=null)connection.disconnect();working=false;}
        },"verified-apk-download").start();
    }
    void finishProgress(){if(progress!=null)progress.dismiss();progress=null;}
    void install(){
        if(ready==null||!ready.isFile())return;
        if(new LocalStore(activity).active()){new AlertDialog.Builder(activity).setMessage("업데이트 다운로드가 완료되었습니다. 예약·대기 작업을 마친 뒤 앱을 다시 열면 설치할 수 있습니다. 진행 중 작업은 유지합니다.").setPositiveButton("확인",null).show();return;}
        if(!activity.getPackageManager().canRequestPackageInstalls()){
            new AlertDialog.Builder(activity).setTitle("업데이트 설치 허용").setMessage("이 앱의 업데이트를 설치하려면 다음 화면에서 ‘이 출처 허용’을 켜 주세요. 돌아오면 설치 화면으로 이어집니다.").setNegativeButton("나중에",null).setPositiveButton("설정 열기",(d,w)->{try{waitingPermission=true;activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,android.net.Uri.parse("package:"+activity.getPackageName())));}catch(Exception e){waitingPermission=false;}}).show();return;
        }
        try{Intent intent=new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(UpdateApkProvider.URI,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("Verified update",UpdateApkProvider.URI));activity.startActivity(intent);installPending=false;}catch(Exception e){new AlertDialog.Builder(activity).setMessage("설치 화면을 열지 못했습니다. 앱 업데이트 확인에서 다시 시도하세요.").setPositiveButton("확인",null).show();}
    }
    boolean resume(){foreground=true;if(installPending&&!waitingPermission&&ready!=null&&!working){install();return true;}if(!waitingPermission)return working;waitingPermission=false;if(activity.getPackageManager().canRequestPackageInstalls())install();return true;}
    void pause(){foreground=false;}
    void destroy(){cancelled=true;finishProgress();}
}
