package kr.swim.phone;

import java.time.Instant;
import java.time.format.DateTimeFormatter;

/** Uses the same trigger and corrected clock as PlanScheduler. */
final class RunNotice {
    static String time(long epoch){return DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss").withZone(Plan.SEOUL).format(Instant.ofEpochMilli(epoch));}
    static String batteryNotice(Plan plan,long now){
        String start=plan.trigger>now?time(plan.trigger)+" (한국 시간)부터":"시작을 누른 직후부터";
        String work=plan.watch()?"취소 자리 조회·예약을 진행할 때 배터리 사용이 늘어납니다. 조회 사이에는 CPU 절전을 허용합니다.":"예약 화면 접속·입력·제출을 진행하며 배터리 사용이 늘어납니다. 완료·중지하면 실행을 종료합니다.";
        String waiting=plan.trigger>now?"그 전에는 브라우저를 계속 실행하지 않고 알람으로 대기합니다. "+(plan.trigger-now>ClockSyncReceiver.HOUR?"실행 1시간 전 ("+time(plan.trigger-ClockSyncReceiver.HOUR)+", 한국 시간)":"대기 등록 직후")+" 서버 시간을 짧게 동기화합니다. 동기화 실패 시 재확인할 수 있습니다. ":"";
        return "배터리 안내: "+waiting+start+" "+work;
    }
    static String message(Plan plan,long now){return message(plan,now,java.util.Map.of());}
    static String money(Long amount){return amount==null?"공식 금액 미확인":String.format(java.util.Locale.KOREA,"%,d원",amount);}
    static String message(Plan plan,long now,java.util.Map<String,Long> quotes){
        java.util.Map<String,BookingQuote.Detail> details=new java.util.LinkedHashMap<>();quotes.forEach((name,amount)->details.put(name,new BookingQuote.Detail(amount,java.util.List.of())));return detailedMessage(plan,now,details);
    }
    static String detailedMessage(Plan plan,long now,java.util.Map<String,BookingQuote.Detail> quotes){
        StringBuilder text=new StringBuilder("입실일 "+plan.date+" / 퇴실일 "+java.time.LocalDate.parse(plan.date).plusDays(plan.nights)+" / "+plan.nights+"박\n\n");
        java.util.List<java.util.List<String>> groups=BookingQuote.groups(plan);boolean candidates=false,known=true;long total=0;
        for(int i=0;i<groups.size();i++){java.util.List<String> group=groups.get(i);if(!plan.mode.equals("multiple")&&group.size()>1)candidates=true;
            for(String name:group){BookingQuote.Detail detail=quotes.get(name);Long amount=detail==null?null:detail.total;if(amount==null)known=false;else total+=amount;
                if(groups.size()>1)text.append("예약자 ").append(i+1).append(" · ");text.append(name.split("_")[0]).append(" / ").append(money(amount)).append("\n");
                if(detail==null||detail.nightlyRates.isEmpty())text.append("  날짜별 요금 미확인\n");else for(BookingQuote.Night row:detail.nightlyRates)text.append("  ").append(row.date).append(" · ").append(row.type).append(" ").append(money(row.amount)).append("\n");}}
        text.append("총 숙박비: ").append(candidates?"우선순위 중 실제 예약되는 사이트의 금액":known&&total>0?money(total):"공식 금액 미확인");
        return text+"\n\n입금 계좌: 농협 317-0028-3427-31\n예금주: (주)쉼오지캠프\n\n예약 후 24시간 이내 입금하지 않을 시 자동으로 예약이 취소됩니다.";
    }
}
