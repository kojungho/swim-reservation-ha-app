package kr.swim.phone;

import android.content.Context;
import android.os.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Bounded, read-only public requests. Never send identity or booking POSTs here. */
final class PhoneReads {
    static volatile boolean testMode=false;
    static final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
    static void monthly(Context c,String month)throws Exception{
        java.time.YearMonth.parse(month);if(new LocalStore(c).active())throw new IllegalStateException("진행·대기 중인 예약을 먼저 중지하세요.");
        LocalStore store=new LocalStore(c);store.saveDocument("monthly-result",new JSONObject().put("pending",true).put("month",month));
        worker.execute(()->{try{JSONObject raw;
            if(testMode){raw=new JSONObject().put("ok",true).put("ym",month).put("open",month+"-28").put("days",new JSONObject().put(month+"-01",0).put(month+"-02",4));}
            else{HttpURLConnection connection=open("https://"+PhoneEngine.HOST+"/camp/api.php?a=cal&ym="+month,"GET");try{if(connection.getResponseCode()!=200)throw new IOException("HTTP "+connection.getResponseCode());raw=new JSONObject(text(connection));}finally{connection.disconnect();}}
            if(!raw.optBoolean("ok")||!month.equals(raw.optString("ym"))||!raw.optString("open").matches("20[0-9]{2}-[0-9]{2}-[0-9]{2}"))throw new IOException("형식 불일치");
            java.time.LocalDate.parse(raw.getString("open"));JSONObject source=raw.getJSONObject("days"),days=new JSONObject();int count=java.time.YearMonth.parse(month).lengthOfMonth();
            for(int i=1;i<=count;i++){String date=String.format(java.util.Locale.ROOT,"%s-%02d",month,i);Object value=source.opt(date);if(value instanceof Number&&((Number)value).doubleValue()==((Number)value).intValue()&&((Number)value).intValue()>=-1)days.put(date,value);else days.put(date,JSONObject.NULL);}
            store.saveDocument("monthly-result",new JSONObject().put("pending",false).put("ok",true).put("month",month).put("openThrough",raw.getString("open")).put("days",days).put("capturedAt",System.currentTimeMillis()));
        }catch(Exception e){try{store.saveDocument("monthly-result",new JSONObject().put("pending",false).put("ok",false).put("month",month).put("error","월별 조회 실패 · 0곳으로 판단하지 않습니다."));}catch(Exception ignored){}}});
    }
    static void time(Context c)throws Exception{
        LocalStore current=new LocalStore(c);if(current.active()&&!current.stage().equals("WAITING"))throw new IllegalStateException("실행 중에는 시각 동기화를 하지 않습니다.");
        worker.execute(()->{LocalStore store=new LocalStore(c);try{long start=System.currentTimeMillis();long date;
            if(testMode)date=start-500;else{HttpURLConnection connection=open("https://"+PhoneEngine.HOST+"/camp/","HEAD");try{if(connection.getResponseCode()!=200)throw new IOException();date=connection.getDate();}finally{connection.disconnect();}}
            SiteClock.save(c,date,start,System.currentTimeMillis());store.saveDocument("clock-result",new JSONObject().put("ok",true));
            if(store.active()&&store.stage().equals("WAITING"))new Handler(Looper.getMainLooper()).post(()->{try{AlarmReceiver.schedule(c,store.load("run").trigger);}catch(Exception ignored){}});
        }catch(Exception e){try{store.saveDocument("clock-result",new JSONObject().put("ok",false).put("error","서버 시각 동기화 실패 · 폰 시각과 구분해 표시합니다."));}catch(Exception ignored){}}});
    }
    static HttpURLConnection open(String address,String method)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection();c.setConnectTimeout(10000);c.setReadTimeout(10000);c.setRequestMethod(method);c.setInstanceFollowRedirects(false);c.setRequestProperty("Cache-Control","no-cache");return c;}
    static String text(HttpURLConnection c)throws Exception{try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] bytes=new byte[4096];int count;while((count=in.read(bytes))!=-1){out.write(bytes,0,count);if(out.size()>1048576)throw new IOException("응답 크기 초과");}return out.toString(StandardCharsets.UTF_8.name());}}
}
