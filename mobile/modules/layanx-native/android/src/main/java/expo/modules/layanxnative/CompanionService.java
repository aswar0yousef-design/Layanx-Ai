package expo.modules.layanxnative;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import java.util.Map;

/**
 * Live updates: while the owner has them on, one long-poll to the paired PC's companion feed (encrypted
 * link). The PC answers as soon as something changes (a new approval, a job stage, a coding agent's
 * step) or after 25 s; the phone then updates its notifications and the widget. Off by default.
 */
public final class CompanionService extends Service {
    private volatile boolean running;
    private Thread worker;

    public static void start(Context c) {
        Intent i = new Intent(c, CompanionService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    public static void stop(Context c) {
        c.stopService(new Intent(c, CompanionService.class));
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // A foreground service must show its notification at once, even if it is about to stop.
        if (Build.VERSION.SDK_INT >= 34) startForeground(Notify.ONGOING_ID, Notify.ongoing(this, null, null, -1), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(Notify.ONGOING_ID, Notify.ongoing(this, null, null, -1));
        if (!DeviceStore.live(this) || DeviceStore.selected(this) == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (worker == null || !worker.isAlive()) {
            running = true;
            worker = new Thread(this::loop, "layanx-companion");
            worker.start();
        }
        return START_STICKY;
    }

    private void loop() {
        String since = null;
        int backoff = 2;
        while (running) {
            LinkClient.Device d = DeviceStore.selected(this);
            if (d == null || !DeviceStore.live(this)) break;
            try {
                String path = "/v1/companion/feed?wait=25" + (since != null ? "&since=" + since : "");
                long asked = System.currentTimeMillis();
                LinkClient.Response r = LinkClient.request(d, "GET", path, null, null, false, 45000);
                DeviceStore.touch(this, d);
                if (r.status == 200) {
                    Map<String, Object> feed = MiniJson.object(r.body);
                    String v = MiniJson.str(feed, "v");
                    boolean same = v != null && v.equals(since);
                    since = v;
                    if (!running) break;
                    Notify.applyFeed(this, d, feed); // also refreshes the PC load numbers
                    backoff = 2;
                    // Nothing changed and the PC answered at once (it did not wait): do not ask again at once.
                    if (same && System.currentTimeMillis() - asked < 2000) pause(3);
                    continue;
                }
                since = null;
                Notify.offline(this, d, r.status == 503 ? "LayanX يبدأ التشغيل" : "HTTP " + r.status);
            } catch (LinkClient.DeviceRemovedException removed) {
                DeviceStore.setLive(this, false);
                Notify.removed(this, d);
                break;
            } catch (Exception e) {
                since = null;
                if (running) Notify.offline(this, d, e.getMessage());
            }
            pause(backoff);
            backoff = Math.min(30, backoff * 2);
        }
        running = false;
        stopSelf();
    }

    private void pause(int seconds) {
        try { Thread.sleep(seconds * 1000L); } catch (InterruptedException e) { running = false; }
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        if (!DeviceStore.live(this)) Notify.clear(this);
        super.onDestroy();
    }
}
