package expo.modules.layanxnative;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Quick settings tile: opens LayanX listening, so a question or a task can be spoken at once. */
public final class AskTileService extends TileService {
    @Override
    public void onStartListening() {
        Tile t = getQsTile();
        if (t == null) return;
        boolean paired = DeviceStore.selected(this) != null;
        t.setState(paired ? Tile.STATE_INACTIVE : Tile.STATE_UNAVAILABLE);
        t.setLabel(getString(R.string.layanx_tile_label));
        t.updateTile();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onClick() {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("layanx://ask?voice=1")).setPackage(getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Runnable go = () -> {
            if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 5, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
            else startActivityAndCollapse(i);
        };
        if (isLocked()) unlockAndRun(go); else go.run();
    }
}
