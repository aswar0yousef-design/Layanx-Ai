package expo.modules.layanxnative;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Home-screen widget: the running job or what waits for approval, how busy the PC is, and a button to
 * ask by voice. It shows what the live-updates service last saw (titles and counts, no secrets).
 */
public final class StatusWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        render(context);
    }

    public static void render(Context c) {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(c);
            int[] ids = manager.getAppWidgetIds(new ComponentName(c, StatusWidget.class));
            if (ids == null || ids.length == 0) return;
            String[] w = DeviceStore.widget(c);
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.layanx_widget);
            v.setTextViewText(R.id.layanx_widget_title, w[0] == null ? "LayanX" : w[0]);
            v.setTextViewText(R.id.layanx_widget_line1, w[1] == null ? c.getString(R.string.layanx_widget_waiting) : w[1]);
            v.setTextViewText(R.id.layanx_widget_line2, w[2] == null ? "" : w[2]);
            int badge = 0;
            try { badge = Integer.parseInt(w[3]); } catch (NumberFormatException ignored) { }
            v.setTextViewText(R.id.layanx_widget_badge, String.valueOf(badge));
            v.setViewVisibility(R.id.layanx_widget_badge, badge > 0 ? View.VISIBLE : View.GONE);
            v.setOnClickPendingIntent(R.id.layanx_widget_root, Notify.open(c, badge > 0 ? "layanx://approvals" : "layanx://home", 6));
            v.setOnClickPendingIntent(R.id.layanx_widget_ask, Notify.open(c, "layanx://ask?voice=1", 7));
            manager.updateAppWidget(ids, v);
        } catch (Exception ignored) {
            // A widget that cannot update keeps its last picture.
        }
    }
}
