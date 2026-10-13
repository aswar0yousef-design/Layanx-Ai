package com.layanx.nativebridge

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONObject

/** Notification buttons that need no fingerprint: "Open the site" on the PC. */
class ActionReceiver : BroadcastReceiver() {
  companion object {
    private const val ACTION_OPEN_SITE = "com.layanx.nativebridge.OPEN_SITE"

    fun openSite(ctx: Context, jobId: String): PendingIntent {
      val i = Intent(ctx, ActionReceiver::class.java)
      i.action = ACTION_OPEN_SITE
      i.putExtra("jobId", jobId)
      i.data = Uri.parse("layanx-site://" + Uri.encode(jobId))
      return PendingIntent.getBroadcast(ctx, Math.floorMod(jobId.hashCode(), 1_000_000), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_OPEN_SITE) return
    val jobId = intent.getStringExtra("jobId") ?: return
    val pending = goAsync()
    val ctx = context.applicationContext
    Thread {
      try {
        val d = LxConfig.load(ctx) ?: throw IllegalStateException("الهاتف غير مربوط")
        val r = LxHttp.call(ctx, d, "POST", "/v1/supervisor/jobs/" + LxHttp.enc(jobId) + "/open", "{}", 9_000)
        val json = try { JSONObject(r.body) } catch (e: Exception) { JSONObject() }
        Notifications.site(ctx, when {
          r.status == 200 -> "فُتح الموقع في متصفح الكمبيوتر: " + json.optString("url")
          r.status == 202 -> "تشغيل الموقع يحتاج موافقتك، وسيصلك طلبها الآن."
          else -> "تعذر فتح الموقع: " + json.optString("error", "HTTP " + r.status)
        })
      } catch (e: Exception) {
        Notifications.site(ctx, "تعذر الوصول إلى الكمبيوتر: " + (e.message ?: ""))
      } finally {
        pending.finish()
      }
    }.start()
  }
}
