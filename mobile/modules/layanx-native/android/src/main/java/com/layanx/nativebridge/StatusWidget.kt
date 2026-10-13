package com.layanx.nativebridge

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

/** Home-screen widget: CPU/RAM of the PC, the running mission, the auto-scalper, and "Ask". */
class StatusWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    render(context, LxConfig.lastFeed(context))
    // The watch service keeps it fresh; without it, refresh now and then.
    val pending = goAsync()
    val ctx = context.applicationContext
    Thread {
      try {
        val d = LxConfig.load(ctx)
        if (d != null) {
          val r = LxHttp.call(ctx, d, "GET", "/v1/companion/feed", null, 8_000)
          if (r.status == 200) {
            LxConfig.saveFeed(ctx, r.body)
            render(ctx, JSONObject(r.body))
          }
        }
      } catch (e: Exception) {
        // keep the last state
      } finally {
        pending.finish()
      }
    }.start()
  }

  companion object {
    fun render(ctx: Context, feed: JSONObject?) {
      val manager = AppWidgetManager.getInstance(ctx) ?: return
      val ids = manager.getAppWidgetIds(ComponentName(ctx, StatusWidget::class.java))
      if (ids == null || ids.isEmpty()) return
      val v = RemoteViews(ctx.packageName, R.layout.layanx_widget)
      val paired = LxConfig.load(ctx) != null
      v.setTextViewText(R.id.lx_title, "LayanX")
      v.setTextViewText(R.id.lx_load, when {
        !paired -> "اربط الهاتف من تطبيق LayanX"
        feed == null -> "لا توجد بيانات بعد"
        else -> WatchService.loadLine(feed).ifEmpty { "متصل" }
      })
      val jobs = feed?.optJSONArray("jobs") ?: JSONArray()
      var jobLine = ""
      for (i in 0 until jobs.length()) {
        val j = jobs.optJSONObject(i) ?: continue
        val total = j.optInt("total")
        jobLine = j.optString("goal") + if (total > 0) " · ${j.optInt("done")}/$total" else ""
        break
      }
      val approvals = feed?.optJSONArray("approvals")?.length() ?: 0
      if (approvals > 0) jobLine = "⏸ $approvals بانتظار موافقتك" + if (jobLine.isNotEmpty()) " · $jobLine" else ""
      v.setTextViewText(R.id.lx_job, jobLine)
      v.setTextViewText(R.id.lx_scalper, WatchService.scalperLine(feed))
      v.setOnClickPendingIntent(R.id.lx_root, Notifications.launchApp(ctx))
      val ask = Intent(ctx, VoiceAskActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      v.setOnClickPendingIntent(R.id.lx_ask, PendingIntent.getActivity(ctx, 12, ask, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      manager.updateAppWidget(ids, v)
    }
  }
}
