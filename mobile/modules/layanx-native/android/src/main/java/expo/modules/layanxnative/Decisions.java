package expo.modules.layanxnative;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import java.util.LinkedHashMap;
import java.util.Map;

/** Sends the owner's decision through the one decision path on the PC (/v1/companion/decide). */
final class Decisions {
    private Decisions() {}

    /** Returns null when the PC took the decision, else a short message for the owner. */
    static String send(Context c, String deviceId, String id, String digest, String decision) {
        LinkClient.Device d = DeviceStore.get(c, deviceId);
        if (d == null) return "هذا الكمبيوتر لم يعد مربوطاً بالهاتف.";
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", id);
        body.put("digest", digest);
        body.put("decision", decision);
        try {
            LinkClient.Response r = LinkClient.request(d, "POST", "/v1/companion/decide", MiniJson.stringify(body), "application/json", false, 20000);
            DeviceStore.touch(c, d);
            Map<String, Object> answer = r.body == null || r.body.isEmpty() ? new LinkedHashMap<>() : MiniJson.object(r.body);
            if (r.status == 200 && Boolean.TRUE.equals(answer.get("ok"))) return null;
            String error = MiniJson.str(answer, "error");
            if ("changed".equals(error)) return "تغيّر الطلب على الكمبيوتر. افتح التطبيق وراجعه من جديد.";
            if ("not_pending".equals(error) || "not_found".equals(error)) return "لم يعد هذا الطلب قائماً (انتهى وقته أو أُجيب عنه).";
            String message = MiniJson.str(answer, "message");
            return message != null ? message : "تعذر إرسال القرار (" + (error != null ? error : "HTTP " + r.status) + ").";
        } catch (LinkClient.DeviceRemovedException e) {
            return "أُلغي ربط هذا الهاتف. اربطه من جديد.";
        } catch (Exception e) {
            return "تعذر الوصول إلى الكمبيوتر: " + e.getMessage();
        }
    }

    static void toast(Context c, String text) {
        Context app = c.getApplicationContext();
        new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(app, text, Toast.LENGTH_LONG).show());
    }
}
