package kr.swim.phone;

import android.content.Context;
import android.net.Uri;
import android.graphics.*;
import java.io.*;
import java.util.*;
import org.json.*;

final class MapPhotos {
    final Context context;final LocalStore store;
    MapPhotos(Context c){context=c;store=new LocalStore(c);}
    synchronized JSONObject state()throws Exception{JSONObject s=store.loadDocument("maps-v1");return s==null?new JSONObject().put("photos",new JSONArray()).put("selected",""):s;}
    File file(String id){if(!id.matches("[a-f0-9-]{36}"))throw new IllegalArgumentException("사진 식별값 불일치");return new File(new File(context.getFilesDir(),"maps"),id+".jpg");}
    synchronized void add(Uri uri)throws Exception{JSONObject s=state();JSONArray photos=s.getJSONArray("photos");if(photos.length()>=6)throw new IllegalArgumentException("배치도 사진은 최대 6장입니다.");
        byte[] bytes;try(InputStream in=context.getContentResolver().openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){if(in==null)throw new IOException();byte[] buffer=new byte[4096];int count;while((count=in.read(buffer))!=-1){out.write(buffer,0,count);if(out.size()>10485760)throw new IllegalArgumentException("사진은 10MB 이내로 선택하세요.");}bytes=out.toByteArray();}
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(options.outWidth<1||options.outHeight<1)throw new IllegalArgumentException("읽을 수 없는 이미지입니다.");options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>1600)options.inSampleSize*=2;options.inJustDecodeBounds=false;Bitmap bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(bitmap==null)throw new IOException();String id=UUID.randomUUID().toString();File target=file(id),temporary=new File(target.getPath()+".tmp");
        if(!target.getParentFile().isDirectory()&&!target.getParentFile().mkdirs()){bitmap.recycle();throw new IOException();}
        try(FileOutputStream out=new FileOutputStream(temporary)){if(!bitmap.compress(Bitmap.CompressFormat.JPEG,88,out))throw new IOException();out.getFD().sync();}finally{bitmap.recycle();}
        if(!temporary.renameTo(target))throw new IOException();photos.put(id);s.put("selected",id);store.saveDocument("maps-v1",s);
    }
    synchronized JSONObject apply(String action,String id)throws Exception{JSONObject s=state();JSONArray photos=s.getJSONArray("photos");boolean found=false;for(int i=0;i<photos.length();i++)if(photos.getString(i).equals(id))found=true;
        if(action.equals("select")){if(!id.isEmpty()&&!found)throw new IllegalArgumentException("등록된 사진이 아닙니다.");s.put("selected",id);}
        else if(action.equals("delete")){if(!found)throw new IllegalArgumentException("등록된 사진이 아닙니다.");for(int i=photos.length()-1;i>=0;i--)if(photos.getString(i).equals(id))photos.remove(i);if(id.equals(s.optString("selected")))s.put("selected","");store.saveDocument("maps-v1",s);if(file(id).exists()&&!file(id).delete())throw new IOException("사진 파일 정리 실패");return s;}
        else throw new IllegalArgumentException("지원하지 않는 사진 동작");store.saveDocument("maps-v1",s);return s;
    }
}
