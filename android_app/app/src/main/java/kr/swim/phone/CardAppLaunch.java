package kr.swim.phone;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.widget.Toast;
import java.net.URISyntaxException;
import java.util.Map;

final class CardAppLaunch {
    private static final String MONIMO="net.ib.android.smcard";
    private static final Map<String,String> PACKAGES=Map.of(
        "monimopay",MONIMO,
        "monimopayauth",MONIMO,
        "mpocket.online.ansimclick","kr.co.samsungcard.mpocket",
        "shinhan-sr-ansimclick","com.shcard.smartpay",
        "kb-auth","com.kbcard.cxh.appcard",
        "lotteappcard","com.lcacApp",
        "cloudpay","com.hanaskcard.paycla",
        "hyundaicardappcardid","com.hyundaicard.appcard",
        "nhallonepayansimclick","nh.smart.nhallonepay",
        "ispmobile","kvp.jjy.MispAndroid320");
    static Intent resolve(Uri link) throws URISyntaxException {
        Intent parsed="intent".equals(link.getScheme())?Intent.parseUri(link.toString(),Intent.URI_INTENT_SCHEME):new Intent(Intent.ACTION_VIEW,link);
        Uri data=parsed.getData();
        String pkg=data==null||data.getScheme()==null?null:PACKAGES.get(data.getScheme());
        if(pkg==null || parsed.getPackage()!=null&&!pkg.equals(parsed.getPackage()))return null;
        return new Intent(Intent.ACTION_VIEW,data).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(pkg);
    }
    static void offer(PaymentActivity activity,Uri uri){
        Intent launch;
        try{launch=resolve(uri);}catch(URISyntaxException e){launch=null;}
        if(launch==null){
            Toast.makeText(activity,"이 인증 앱 연결을 인식하지 못했습니다. 결제창에서 다른 인증 방법을 선택할 수 있습니다.",Toast.LENGTH_LONG).show();
            return;
        }
        Intent verified=launch;
        new AlertDialog.Builder(activity).setMessage(MONIMO.equals(verified.getPackage())?"모니모 앱을 열까요?":"카드 인증 앱을 열까요?")
            .setNegativeButton("결제창에 머무르기",null)
            .setPositiveButton("열기",(dialog,which)->{
                try{activity.startActivity(verified);}
                catch(ActivityNotFoundException|SecurityException error){Toast.makeText(activity,"카드 인증 앱을 열 수 없습니다. 설치 상태를 확인하세요.",Toast.LENGTH_LONG).show();}
            }).show();
    }
}
