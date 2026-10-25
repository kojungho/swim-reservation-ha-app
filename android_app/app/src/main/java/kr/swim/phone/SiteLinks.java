package kr.swim.phone;

import android.net.Uri;
import java.time.LocalDate;

/** No guest information is placed in external browser URLs. */
final class SiteLinks {
    static String reservation(String date){Plan p=new Plan();p.date=LocalDate.parse(date).toString();return camp(p,"",0);}
    static String camp(Plan p,String page,int site){return "https://"+PhoneEngine.HOST+"/camp/"+page+"?ci="+LocalDate.parse(p.date)+"&co="+LocalDate.parse(p.date).plusDays(p.nights)+"&ad="+p.adults+"&ch=0&in=0"+(site>0?"&site="+site:"");}
    static Uri receipts(){return Uri.parse("https://"+PhoneEngine.HOST+"/camp/lookup.php");}
}
