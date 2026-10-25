package kr.swim.phone;

import android.content.*;
import android.security.keystore.*;
import android.util.*;
import org.json.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.security.KeyStore;
import java.nio.charset.StandardCharsets;

/** Atomic encrypted private preferences; no analytics, backups or plaintext guest logs. */
public final class LocalStore {
    private final SharedPreferences prefs;
    public LocalStore(Context c){prefs=c.getSharedPreferences("phone-private",Context.MODE_PRIVATE);}
    private javax.crypto.SecretKey key() throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if(!ks.containsAlias("swim-phone-v1")) {
            KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            gen.init(new KeyGenParameterSpec.Builder("swim-phone-v1",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());gen.generateKey();
        }
        return (javax.crypto.SecretKey)ks.getKey("swim-phone-v1",null);
    }
    public synchronized void save(String slot,Plan plan) throws Exception {
        saveDocument(slot,plan.json());
    }
    public synchronized void saveDocument(String slot,JSONObject document) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        JSONObject box=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP))
            .put("data",Base64.encodeToString(cipher.doFinal(document.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP));
        if(!prefs.edit().putString(slot,box.toString()).commit()) throw new IllegalStateException("폰 저장에 실패했습니다.");
    }
    public synchronized Plan load(String slot) throws Exception {
        JSONObject document=loadDocument(slot);return document==null?new Plan():Plan.from(document);
    }
    public synchronized JSONObject loadDocument(String slot) throws Exception {
        String raw=prefs.getString(slot,null);if(raw==null)return null;
        JSONObject box=new JSONObject(raw);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(box.getString("iv"),Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(box.getString("data"),Base64.NO_WRAP)),StandardCharsets.UTF_8));
    }
    public synchronized void state(String stage,String message,boolean active) {
        String line=java.time.LocalTime.now(Plan.SEOUL).withNano(0)+" · "+message;
        String log=prefs.getString("log","")+line+"\n";String[] lines=log.split("\n");
        if(lines.length>100) log=String.join("\n",java.util.Arrays.copyOfRange(lines,lines.length-100,lines.length))+"\n";
        if(!prefs.edit().putString("stage",stage).putString("message",message).putBoolean("active",active)
            .putLong("heartbeat",System.currentTimeMillis()).putString("log",log).commit()) throw new IllegalStateException("상태 저장 실패: 안전하게 중지합니다.");
    }
    public String stage(){return prefs.getString("stage","IDLE");}
    public boolean active(){return prefs.getBoolean("active",false);}
    public long watchDueElapsed(){return prefs.getLong("watch-due-elapsed",0);}
    public void watchDueElapsed(long when){if(!prefs.edit().putLong("watch-due-elapsed",when).commit())throw new IllegalStateException("감시 시각 저장 실패");}
    public String message(){return prefs.getString("message","폰 내부 독립 실행 · HA 연결 없음");}
    public String log(){return prefs.getString("log","");}
    public boolean uncertain(){return prefs.getBoolean("unverified-submit",false);}
    public void markSubmitted() {
        if(!prefs.edit().putBoolean("unverified-submit",true).commit())throw new IllegalStateException("최종 제출 기록을 저장하지 못했습니다.");
    }
    public void acknowledgeReceiptCheck(){prefs.edit().putBoolean("unverified-submit",false).commit();}
    public void completed(){acknowledgeReceiptCheck();}
}
