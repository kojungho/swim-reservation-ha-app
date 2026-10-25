package kr.swim.phone;

import org.json.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** One active plan in the preview. Never shares data or sessions with HA. */
public final class Plan {
    public static final int MIN_POLL_SECONDS=600;
    public static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    public String date="", name="", payer="", phone="", birth="", rooms="";
    public String mode="reserve";
    public String siteVersion="swimozicamp-v1", arrival="", request="";
    public int adults=2;
    public int nights=1, pollSeconds=MIN_POLL_SECONDS;
    public long trigger=0;
    public boolean consent=false;
    boolean simulation=false; // Only the built-in demo and instrumentation set this; no remote configuration.
    public boolean demo() { return mode.equals("demo")||simulation; }
    public boolean watch() { return mode.equals("watch"); }
    public long stayStart() { return LocalDate.parse(date).atStartOfDay(SEOUL).toInstant().toEpochMilli(); }
    public List<String> priorities() { return Arrays.stream(rooms.split("[,\\n]")).map(String::trim).filter(s->!s.isEmpty()).distinct().collect(java.util.stream.Collectors.toList()); }
    public void validate(boolean lookup) {
        try { if(stayStart() <= System.currentTimeMillis()) throw new IllegalArgumentException(); }
        catch(Exception e) { throw new IllegalArgumentException("입실일을 한국 시간 기준 미래 날짜(YYYY-MM-DD)로 입력해 주세요."); }
        if(nights<1 || nights>6) throw new IllegalArgumentException("박수는 1~6박입니다.");
        if(lookup) return;
        if(!List.of("reserve","watch","demo").contains(mode)) throw new IllegalArgumentException("지원하지 않는 실행 모드입니다.");
        if(priorities().isEmpty()) throw new IllegalArgumentException("객실명을 우선순위대로 입력해 주세요.");
        if(!siteVersion.equals("swimozicamp-v1")&&!demo())throw new IllegalArgumentException("구사이트 일정입니다. 날짜·사이트·예약자를 확인하고 다시 등록하세요.");
        if(name.isBlank() || name.length()>50 || payer.length()>50) throw new IllegalArgumentException("예약자명·입금자명을 확인해 주세요.");
        if(adults<1||adults>2||request.length()>1000||arrival.length()>20)throw new IllegalArgumentException("인원·도착 시간·요청사항을 확인해 주세요.");
        if(!phone.matches("01[0-9]{8,9}")) throw new IllegalArgumentException("휴대폰 번호를 확인해 주세요.");
        if(pollSeconds<MIN_POLL_SECONDS || pollSeconds>3600 || pollSeconds%60!=0) throw new IllegalArgumentException("감시 간격은 10~60분의 정수입니다.");
        if(!consent) throw new IllegalArgumentException("예약 사이트 약관을 직접 확인하고 자동 최종 제출에 동의해 주세요.");
        if(trigger>0 && trigger>=stayStart()) throw new IllegalArgumentException("실행 시각은 입실일 00시 이전이어야 합니다.");
    }
    public JSONObject json() throws JSONException {
        return new JSONObject().put("date",date).put("nights",nights).put("name",name).put("payer",payer).put("phone",phone).put("birth",birth)
            .put("rooms",rooms).put("mode",mode).put("trigger",trigger).put("pollSeconds",pollSeconds).put("consent",consent).put("simulation",simulation)
            .put("siteVersion",siteVersion).put("adults",adults).put("arrival",arrival).put("request",request);
    }
    public static Plan from(JSONObject j) {
        Plan p=new Plan(); p.date=j.optString("date"); p.nights=j.optInt("nights",1); p.name=j.optString("name");p.payer=j.optString("payer");
        p.phone=j.optString("phone");p.birth=j.optString("birth");p.rooms=j.optString("rooms");p.mode=j.optString("mode","reserve");
        p.trigger=j.optLong("trigger");p.pollSeconds=Math.max(MIN_POLL_SECONDS,j.optInt("pollSeconds",MIN_POLL_SECONDS));p.consent=j.optBoolean("consent",false);p.simulation=j.optBoolean("simulation",false);
        p.siteVersion=j.optString("siteVersion","legacy");p.adults=j.optInt("adults",2);p.arrival=j.optString("arrival");p.request=j.optString("request");return p;
    }
    public static Plan sample() {
        Plan p=new Plan();p.mode="demo";p.date=LocalDate.now(SEOUL).plusDays(10).toString();p.name="모의예약자";p.payer="모의입금자";
        p.phone="01000000000";p.birth="19900101";p.rooms="솔_산맥존";p.consent=true;return p;
    }
}
