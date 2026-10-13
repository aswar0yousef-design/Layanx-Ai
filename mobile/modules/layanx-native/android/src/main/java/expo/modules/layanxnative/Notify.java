package expo.modules.layanxnative;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.text.SimpleDateFormat;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * Everything LayanX shows outside the app: the ongoing "live" notification (the running job, its stage
 * and progress, coding agents at work, how busy the PC is), one notification per approval with
 * Approve (fingerprint first) and Deny, and a short notice when a job or a coding agent finishes.
 * No secrets are shown; on a locked phone the details stay hidden unless the owner allowed them.
 */
public final class Notify {
    private Notify() {}

    static final String LIVE = "layanx_live", APPROVALS = "layanx_approvals", DONE = "layanx_done";
    static final int ONGOING_ID = 7100, APPROVAL_ID = 7200, DONE_ID = 7300, NOTICE_ID = 7400;

    private static final Set<String> ACTIVE = new HashSet<>(java.util.Arrays.asList("queued", "planning", "running", "waiting_approval", "verifying"));
    private static final Set<String> posted = new HashSet<>();
    private static final Map<String, String> lastJob = new HashMap<>(), lastAgent = new HashMap<>();

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel live = new NotificationChannel(LIVE, "متابعة مباشرة", NotificationManager.IMPORTANCE_LOW);
        live.setDescription("المهمة الجارية وحالة الكمبيوتر");
        live.setShowBadge(false);
        NotificationChannel ap = new NotificationChannel(APPROVALS, "طلبات الموافقة", NotificationManager.IMPORTANCE_HIGH);
        ap.setDescription("إجراءات حساسة تنتظر موافقتك (LayanX و Claude Code و Codex)");
        NotificationChannel done = new NotificationChannel(DONE, "اكتمال المهام", NotificationManager.IMPORTANCE_DEFAULT);
        done.setDescription("عند انتهاء مهمة أو وكيل برمجة");
        nm.createNotificationChannel(live);
        nm.createNotificationChannel(ap);
        nm.createNotificationChannel(done);
    }

    static PendingIntent open(Context c, String uri, int request) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(c.getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, request, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static NotificationCompat.Builder base(Context c, String channel) {
        channels(c);
        return new NotificationCompat.Builder(c, channel).setSmallIcon(R.drawable.ic_layanx).setColor(0xFF6D4AFF);
    }

    private static void post(Context c, String tag, int id, Notification n) {
        try { NotificationManagerCompat.from(c).notify(tag, id, n); } catch (SecurityException ignored) { /* notifications not allowed */ }
    }

    private static String computer(LinkClient.Device d) { return d != null && d.computer != null ? d.computer : "الكمبيوتر"; }

    /** The service's own notification (it must have one from its first moment). */
    static Notification ongoing(Context c, String title, String text, int progress) {
        NotificationCompat.Builder b = base(c, LIVE)
                .setContentTitle(title == null ? "LayanX" : title)
                .setContentText(text == null ? c.getString(R.string.layanx_live_service) : text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text == null ? c.getString(R.string.layanx_live_service) : text))
                .setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_PROGRESS)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(open(c, "layanx://home", 1));
        if (progress >= 0) b.setProgress(100, progress, false);
        // Android 16 shows a promoted ongoing notification as a "live update" chip in the status bar.
        Bundle extras = new Bundle();
        extras.putBoolean("android.requestPromotedOngoing", true);
        b.addExtras(extras);
        return b.build();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Map<String, Object> m, String k) {
        Object v = m.get(k);
        return v instanceof List ? (List<Map<String, Object>>) v : java.util.Collections.<Map<String, Object>>emptyList();
    }

    private static String agentName(String a) { return "claude".equals(a) ? "Claude Code" : "codex".equals(a) ? "Codex" : String.valueOf(a); }

    private static String jobStatus(String s) {
        switch (s == null ? "" : s) {
            case "queued": return "في الانتظار";
            case "planning": return "يخطط";
            case "running": return "يعمل";
            case "waiting_approval": return "ينتظر موافقتك";
            case "verifying": return "تحقق نهائي";
            case "completed": return "اكتملت";
            case "failed": return "توقفت";
            case "cancelled": return "أُلغيت";
            case "budget_exhausted": return "انتهى الوقت";
            default: return s;
        }
    }

    /** The PC writes times as toISOString() ("2026-10-13T08:00:00.000Z"); java.time needs API 26. */
    private static long millis(Object iso) {
        if (iso == null) return 0;
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            return f.parse(iso.toString()).getTime();
        } catch (Exception e) { return 0; }
    }

    /** Applies one companion feed: the live notification, approvals, finished work and the widget. */
    @SuppressWarnings("unchecked")
    static synchronized void applyFeed(Context c, LinkClient.Device d, Map<String, Object> feed) {
        List<Map<String, Object>> approvals = list(feed, "approvals"), jobs = list(feed, "jobs"), agents = list(feed, "agents");
        Map<String, Object> pc = feed.get("pc") instanceof Map ? (Map<String, Object>) feed.get("pc") : null;

        // 1. One notification per approval; ones that were decided or expired disappear.
        Set<String> current = new HashSet<>();
        for (Map<String, Object> a : approvals) {
            String id = MiniJson.str(a, "id");
            if (id == null) continue;
            current.add(id);
            if (posted.add(id)) post(c, id, APPROVAL_ID, approval(c, d, a));
        }
        posted.retainAll(current);
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            for (StatusBarNotification s : nm.getActiveNotifications())
                if (s.getId() == APPROVAL_ID && s.getTag() != null && !current.contains(s.getTag())) nm.cancel(s.getTag(), APPROVAL_ID);
        } catch (Exception ignored) { }

        // 2. Finished work: a job that was running and has ended, a coding agent that stopped.
        for (Map<String, Object> j : jobs) {
            String id = MiniJson.str(j, "id"), st = MiniJson.str(j, "status");
            String before = lastJob.put(id, st);
            if (before != null && ACTIVE.contains(before) && !ACTIVE.contains(st)) {
                String result = MiniJson.str(j, "result");
                post(c, "job:" + id, DONE_ID, base(c, DONE).setContentTitle("المهمة " + jobStatus(st) + " · " + computer(d))
                        .setContentText(MiniJson.str(j, "goal")).setStyle(new NotificationCompat.BigTextStyle().bigText(MiniJson.str(j, "goal") + (result != null ? "\n" + result : "")))
                        .setAutoCancel(true).setContentIntent(open(c, "layanx://jobs", 3)).build());
            }
        }
        for (Map<String, Object> s : agents) {
            String id = MiniJson.str(s, "id"), st = MiniJson.str(s, "status");
            String before = lastAgent.put(id, st);
            if ("working".equals(before) && ("idle".equals(st) || "ended".equals(st))) {
                post(c, "agent:" + id, DONE_ID, base(c, DONE).setContentTitle(agentName(MiniJson.str(s, "agent")) + " انتهى · " + MiniJson.str(s, "project"))
                        .setContentText(MiniJson.str(s, "prompt") != null ? MiniJson.str(s, "prompt") : "انتهى من العمل").setAutoCancel(true)
                        .setTimeoutAfter(30 * 60_000L).setContentIntent(open(c, "layanx://home", 1)).build());
            }
        }

        // 3. The live notification and the widget tell the same story.
        Map<String, Object> job = null;
        for (Map<String, Object> j : jobs) if (ACTIVE.contains(MiniJson.str(j, "status"))) { job = j; break; }
        Map<String, Object> agent = null;
        for (Map<String, Object> s : agents) if ("working".equals(MiniJson.str(s, "status")) || "waiting".equals(MiniJson.str(s, "status"))) { agent = s; break; }
        String load = pc == null ? "" : "المعالج " + num(pc.get("cpu")) + "% · الذاكرة " + num(pc.get("ram")) + "%" + (pc.get("gpu") != null ? " · GPU " + num(pc.get("gpu")) + "%" : "");

        String title, text; int progress = -1;
        if (!approvals.isEmpty()) {
            title = approvals.size() == 1 ? "طلب ينتظر موافقتك" : approvals.size() + " طلبات تنتظر موافقتك";
            text = MiniJson.str(approvals.get(0), "title");
        } else if (job != null) {
            title = MiniJson.str(job, "goal");
            Map<String, Object> m = job.get("milestone") instanceof Map ? (Map<String, Object>) job.get("milestone") : null;
            text = m != null ? "المرحلة " + num(m.get("index")) + "/" + num(m.get("total")) + ": " + MiniJson.str(m, "title") : jobStatus(MiniJson.str(job, "status"));
            Object p = job.get("progress");
            progress = p instanceof Number ? (int) Math.round(((Number) p).doubleValue() * 100) : 0;
        } else if (agent != null) {
            title = agentName(MiniJson.str(agent, "agent")) + " يعمل · " + MiniJson.str(agent, "project");
            String tool = MiniJson.str(agent, "lastTool");
            text = tool != null ? tool + (MiniJson.str(agent, "lastDetail") != null ? ": " + MiniJson.str(agent, "lastDetail") : "") : "يعمل الآن";
        } else {
            title = "LayanX متصل · " + computer(d);
            text = load.isEmpty() ? "لا توجد مهام جارية" : "لا توجد مهام جارية · " + load;
        }
        if (!load.isEmpty() && (job != null || agent != null || !approvals.isEmpty())) text = text + "\n" + load;
        if (DeviceStore.live(c)) post(c, null, ONGOING_ID, ongoing(c, title, text, progress));
        DeviceStore.saveWidget(c, title, text.split("\n")[0], load.isEmpty() ? computer(d) : computer(d) + " · " + load, approvals.size());
        StatusWidget.render(c);
    }

    private static String num(Object v) { return v instanceof Number ? String.valueOf(Math.round(((Number) v).doubleValue())) : "—"; }

    private static Notification approval(Context c, LinkClient.Device d, Map<String, Object> a) {
        String id = MiniJson.str(a, "id"), digest = MiniJson.str(a, "digest"), tool = MiniJson.str(a, "tool");
        String title = MiniJson.str(a, "title"), detail = MiniJson.str(a, "detail");
        boolean agent = "agent".equals(MiniJson.str(a, "kind"));
        String heading = (agent ? "يطلب الإذن: " : "بانتظار موافقتك: ") + (tool == null ? "" : tool);
        String body = (title == null ? "" : title) + (detail == null || detail.isEmpty() ? "" : "\n" + detail);
        int request = id.hashCode() & 0x0fffffff;
        Intent approve = new Intent(c, ApproveActivity.class)
                .putExtra("device", d.id).putExtra("id", id).putExtra("digest", digest).putExtra("title", heading).putExtra("detail", body)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        Intent deny = new Intent(c, DecisionReceiver.class).putExtra("device", d.id).putExtra("id", id).putExtra("digest", digest);
        NotificationCompat.Builder b = base(c, APPROVALS)
                .setContentTitle(heading)
                .setContentText(title)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setSubText(computer(d))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setOnlyAlertOnce(true)
                .setAutoCancel(false)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(base(c, APPROVALS).setContentTitle("LayanX: طلب ينتظر موافقتك").setContentText("افتح القفل لرؤية التفاصيل").build())
                .setContentIntent(open(c, "layanx://approvals", 2))
                .addAction(0, "موافقة (بالبصمة)", PendingIntent.getActivity(c, request, approve, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
                .addAction(0, "رفض", PendingIntent.getBroadcast(c, request, deny, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        long expires = millis(a.get("expiresAt"));
        if (expires > System.currentTimeMillis()) b.setTimeoutAfter(expires - System.currentTimeMillis());
        return b.build();
    }

    static void cancelApproval(Context c, String id) {
        NotificationManagerCompat.from(c).cancel(id, APPROVAL_ID);
        synchronized (Notify.class) { posted.remove(id); }
    }

    static void offline(Context c, LinkClient.Device d, String why) {
        if (!DeviceStore.live(c)) return;
        post(c, null, ONGOING_ID, ongoing(c, "لا يمكن الوصول إلى " + computer(d), "سيعيد المحاولة تلقائياً. تأكد أن الكمبيوتر يعمل وأن الهاتف على نفس الشبكة أو Tailscale متصل.", -1));
        DeviceStore.saveWidget(c, "LayanX", "غير متصل بـ " + computer(d), why == null ? "" : why, 0);
        StatusWidget.render(c);
    }

    static void removed(Context c, LinkClient.Device d) {
        post(c, null, NOTICE_ID, base(c, DONE).setContentTitle("أُلغي ربط هذا الهاتف")
                .setContentText(computer(d) + " لم يعد يقبل هذا الهاتف. اربطه من جديد بمسح الرمز.").setAutoCancel(true)
                .setContentIntent(open(c, "layanx://settings", 4)).build());
        DeviceStore.saveWidget(c, "LayanX", "اربط الهاتف من جديد", computer(d), 0);
        StatusWidget.render(c);
    }

    /** Live updates off: the ongoing notification and the approval notifications go away. */
    static synchronized void clear(Context c) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(c);
        nm.cancel(ONGOING_ID);
        for (String id : posted) nm.cancel(id, APPROVAL_ID);
        posted.clear();
        lastJob.clear();
        lastAgent.clear();
        DeviceStore.saveWidget(c, "LayanX", null, "", 0);
        StatusWidget.render(c);
    }
}
