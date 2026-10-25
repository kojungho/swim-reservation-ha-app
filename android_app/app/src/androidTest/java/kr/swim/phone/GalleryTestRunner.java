package kr.swim.phone;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.net.Uri;
import android.os.*;
import java.io.*;
import java.util.*;
import org.json.*;
/** Local synthetic images only; no camping-site connection or booking. */
public final class GalleryTestRunner extends EngineTestRunner {
 @Override public void onStart(){
  app=getTargetContext();store=new LocalStore(app);JSONObject backup=null;AppUpdates.MetadataSource original=AppUpdates.source;String added=null;File fixture=new File(app.getCacheDir(),"gallery-export-test.png");
  try{
   PhoneReads.testMode=true;store.state("WAITING","사진 UI 모의 검증",true);
   AppUpdates.source=()->new JSONObject().put("packageId","kr.swim.phone").put("versionCode",BuildConfig.VERSION_CODE).put("versionName",BuildConfig.VERSION_NAME).put("apkUrl","https://github.com/kojungho/swim-reservation-ha-app/releases/download/phone-test/mock.apk");
   MapPhotos photos=new MapPhotos(app);backup=photos.state();store.saveDocument("maps-v1",new JSONObject().put("photos",new JSONArray()).put("selected",""));
   Bitmap image=Bitmap.createBitmap(24,16,Bitmap.Config.ARGB_8888);image.eraseColor(0xff246b50);try(OutputStream out=new FileOutputStream(fixture)){image.compress(Bitmap.CompressFormat.PNG,100,out);}finally{image.recycle();}
   photos.add(Uri.fromFile(fixture));added=photos.state().getJSONArray("photos").getString(0);
   String before=photos.state().toString();ByteArrayOutputStream exported=new ByteArrayOutputStream();photos.exportTo(added,exported);
   check(Arrays.equals(java.nio.file.Files.readAllBytes(photos.file(added).toPath()),exported.toByteArray()),"export keeps registered JPEG bytes unchanged");
   check(before.equals(photos.state().toString()),"export preserves count and active photo");
   boolean rejected=false;try{photos.exportTo(UUID.randomUUID().toString(),new ByteArrayOutputStream());}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"unregistered photo export rejected");
   rejected=false;try{photos.exportTo("../maps-v1",new ByteArrayOutputStream());}catch(IllegalArgumentException expected){rejected=true;}check(rejected,"path traversal rejected");
   activity=startActivitySync(new Intent(app,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));uiReady();
   Intent save=((MainActivity)activity).mapExportIntent(added);
   check(Intent.ACTION_CREATE_DOCUMENT.equals(save.getAction())&&"image/jpeg".equals(save.getType())&&save.hasCategory(Intent.CATEGORY_OPENABLE),"download uses system save-document picker without storage permission");
   check(save.getStringExtra(Intent.EXTRA_TITLE).equals("swim-map-"+added+".jpg"),"save filename has safe registered photo ID");
   js("$('siteMapDialog').showModal();refreshPhoneMaps()");
   check(js("$('siteMapUploadButton').hidden&&getComputedStyle($('siteMapUploadButton')).display==='none'").equals("true"),"top registration button never displayed");
   check(js("document.querySelectorAll('#galleryAddButton').length===1&&$('mapGallery').lastElementChild.id==='galleryAddButton'").equals("true"),"only one bottom add tile");
   check(js("[...document.querySelectorAll('#mapGallery button')].filter(b=>b.textContent==='다운로드').length").equals("1"),"registered photo has download button");
   check(!ReservationService.alive(),"gallery verification never starts reservation engine");
   js("phonePeriodQueued='';clearTimeout(phonePeriodTimer)");
   Bundle result=new Bundle();result.putString("stream",assertions+" gallery assertions passed\n");finish(Activity.RESULT_OK,result);
  }catch(Throwable error){Bundle result=new Bundle();result.putString("stream","FAILED: "+error+"\n");finish(Activity.RESULT_CANCELED,result);}
  finally{AppUpdates.source=original;PhoneReads.testMode=false;releaseActivity();try{if(added!=null)new MapPhotos(app).file(added).delete();fixture.delete();if(backup!=null)store.saveDocument("maps-v1",backup);}catch(Exception ignored){}store.state("IDLE","사진 검증 종료",false);}
 }
}
