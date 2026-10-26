package kr.swim.phone;
import org.junit.Test;import static org.junit.Assert.*;
public class RunPermissionsTest {
 @Test public void missingPermissionsAreCheckedForEachAttempt(){assertEquals(RunPermissions.Missing.NOTIFICATIONS,RunPermissions.missing(false,false,false,true));assertEquals(RunPermissions.Missing.ALARM,RunPermissions.missing(true,false,false,true));assertEquals(RunPermissions.Missing.BATTERY,RunPermissions.missing(true,true,false,true));assertNull(RunPermissions.missing(true,true,true,true));assertEquals(RunPermissions.Missing.NOTIFICATIONS,RunPermissions.missing(false,true,true,true));}
 @Test public void immediateRunDoesNotDemandSchedulePermissions(){assertNull(RunPermissions.missing(true,false,false,false));}
}
