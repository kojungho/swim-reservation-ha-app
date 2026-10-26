package kr.swim.phone;
import org.json.*;
/** Execution receipts describe the submission time; current payment comes only from a fresh lookup. */
final class ResultStatus {
    static String batchStage(int success,int total){return total<=0?"FAILED":success==total?"SUCCESS":success>0?"PARTIAL":"NO_ROOM";}
    static String batchMessage(int success,int total){
        if(total<=0)return "예약 대상 없음 · 예약 신청을 실행하지 않았습니다.";
        if(success<=0)return "예약 신청 0건 / 대상 "+total+"건 · 예약 가능한 객실이 없습니다.";
        return "예약 신청 완료 "+success+"건 / 대상 "+total+"건 · 확인된 "+success+"건은 신청 당시 입금 대기입니다. 현재 입금·취소 상태는 예약 내역을 조회해 확인하세요.";
    }
    static void repairLegacyResult(android.content.Context c,int slot){
        LocalStore store=new LocalStore(c,slot);
        if(store.active()||!(store.stage().equals("SUCCESS")||store.stage().equals("PARTIAL"))||!store.message().equals("다인·다중 결과: 완료 0 / 0 · 각 예약은 입금 대기입니다."))return;
        store.state("CHECK_REQUIRED","이전 버전의 0/0 결과는 예약 성공 증거가 아닙니다. 예약 내역을 조회해 확인하세요.",false);
        ReservationService.channel(c);c.getSystemService(android.app.NotificationManager.class).notify(20+slot,ReservationService.notice(c,store.message(),false,slot));
    }
    static String title(String stage,boolean demo){
        String title=switch(stage){case "WAITING"->"예약 대기";case "WATCHING"->"취소 자리 대기";case "STARTING","PREPARING"->"예약 실행 중";case "SUBMITTING"->"예약 제출 중";case "SUCCESS"->"예약 신청 완료";case "PARTIAL"->"일부 신청 완료 · 확인 필요";case "NO_ROOM"->"예약 가능 객실 없음";case "CHECK_REQUIRED"->"예약 결과 확인 필요";case "FAILED"->"예약 실행 실패";case "STOPPED"->"예약 중지";case "INSPECTED"->"객실 조회 완료";default->"예약 작업 상태";};
        return demo?"[모의] "+title:title;
    }
    static String lookupMessage(JSONArray rows,int failures){
        int pending=0,confirmed=0,closed=0,unknown=0;
        for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);String status=row==null?"":row.optString("paymentStatus");switch(status){case "pending":pending++;break;case "confirmed":confirmed++;break;case "closed":closed++;break;default:unknown++;}}
        String text=rows.length()==0?(failures>0?"조회 실패 · 예약 유무를 확인하지 못했습니다.":"조회된 예약 내역이 없습니다."):"조회된 내역 "+rows.length()+"건 · 입금 대기 "+pending+"건 · 예약 확정 "+confirmed+"건 · 취소·만료 "+closed+"건"+(unknown>0?" · 상태 미확인 "+unknown+"건":"");
        return text+(failures>0?" · 조회 실패 "+failures+"명 · 일부 내역이 누락될 수 있습니다.":"");
    }
}
