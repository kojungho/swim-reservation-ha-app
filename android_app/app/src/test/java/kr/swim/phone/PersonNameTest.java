package kr.swim.phone;
import org.junit.Test;import static org.junit.Assert.*;
public class PersonNameTest {
 @Test public void completedInternationalNamesPassAndIncompleteJamoDoNot(){
  for(String value:new String[]{"고중호","홍 길동","O’Neill","Jean-Luc","José","Jose\u0301",java.text.Normalizer.normalize("김",java.text.Normalizer.Form.NFD),"王小明"})assertTrue(value,PersonName.valid(value));
  for(String value:new String[]{""," ","ㄴ","ㄱㅏ","ㅏ","홍ㄴ","ᄂ","123","홍123","홍😀","-홍","홍-","\u0301","홍\n길동","a".repeat(51)})assertFalse(value,PersonName.valid(value));
 }
 @Test public void nativePlanCannotRunWithAnIncompleteName(){
  Plan plan=Plan.sample();plan.name="ㄴ";try{plan.validate(false);fail("incomplete name accepted");}catch(IllegalArgumentException expected){assertTrue(expected.getMessage().contains("예약자명"));}
 }
}
