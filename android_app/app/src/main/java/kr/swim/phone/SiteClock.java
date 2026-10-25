package kr.swim.phone;

import android.content.Context;
import org.json.JSONObject;

final class SiteClock {
    static long offset(Context c){return c.getSharedPreferences("site-clock",0).getLong("offset",0);}
    static long now(Context c){return System.currentTimeMillis()+offset(c);}
    static JSONObject state(Context c)throws Exception{android.content.SharedPreferences p=c.getSharedPreferences("site-clock",0);long updated=p.getLong("updated",0);return new JSONObject().put("offset",p.getLong("offset",0)).put("updated",updated).put("rtt",p.getLong("rtt",0)).put("synced",updated>0&&System.currentTimeMillis()-updated<600000);}
    static void save(Context c,long date,long start,long end){if(date<=0||end<start||end-start>5000)throw new IllegalArgumentException("서버 시간 응답을 검증하지 못했습니다.");long offset=date+500-(start+end)/2;
        if(Math.abs(offset)>86400000L)throw new IllegalArgumentException("폰과 서버 시간이 하루 이상 다릅니다. 시스템 시각부터 확인하세요.");
        if(!c.getSharedPreferences("site-clock",0).edit().putLong("offset",offset).putLong("updated",end).putLong("rtt",end-start).commit())throw new IllegalStateException("서버 시각 저장 실패");}
}
