package expo.modules.layanxnative;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a restart or an app update, live updates come back if the owner had them on. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        try {
            if (DeviceStore.live(context) && DeviceStore.selected(context) != null) CompanionService.start(context);
            StatusWidget.render(context);
        } catch (Exception ignored) {
            // Android may refuse a background start; the app restarts it when opened.
        }
    }
}
