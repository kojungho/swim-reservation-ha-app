package kr.swim.phone;
import android.content.*;
/** Runtime storage scope; guest profiles and UI drafts still use slot zero. */
final class RunContext extends ContextWrapper {
    final int slot;
    RunContext(Context base,int slot){super(base);this.slot=slot;}
    static int slot(Context c){return c instanceof RunContext?((RunContext)c).slot:0;}
}
