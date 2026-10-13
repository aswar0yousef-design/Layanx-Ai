package expo.modules.layanxnative;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** "Deny" on an approval notification: refusing needs no fingerprint (it only stops work). */
public final class DecisionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String device = intent.getStringExtra("device"), id = intent.getStringExtra("id"), digest = intent.getStringExtra("digest");
        if (device == null || id == null || digest == null) return;
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                String error = Decisions.send(app, device, id, digest, "deny");
                if (error == null) {
                    Notify.cancelApproval(app, id);
                    Decisions.toast(app, "تم الرفض.");
                } else {
                    Decisions.toast(app, error);
                }
            } finally {
                pending.finish();
            }
        }, "layanx-deny").start();
    }
}
