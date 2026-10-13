package com.layanx.nativebridge

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * Follows the paired PC while the app is closed: one long-poll request at a time to
 * /v1/companion/feed, over the pinned TLS connection. No cloud push service is involved;
 * when the phone cannot reach the PC it backs off and tries again.
 */
class WatchService : Service() {
  companion object {
    private val ACTIVE = setOf("queued", "planning", "running", "waiting_approval", "verifying")

    fun start(ctx: Context) {
      ContextCompat.startForegroundService(ctx, Intent(ctx, WatchService::class.java))
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, WatchService::class.java))
    }

    fun loadLine(feed: JSONObject?): String {
      val load = feed?.optJSONObject("load") ?: return ""
      val cpu = load.optJSONObject("cpu")?.optInt("percent", -1) ?: -1
      val ram = load.optJSONObject("memory")?.optInt("percent", -1) ?: -1
      if (cpu < 0 && ram < 0) return ""
      return "المعالج $cpu% · الذاكرة $ram%"
    }

    fun scalperLine(feed: JSONObject?): String {
      val s = feed?.optJSONObject("scalper") ?: return ""
      val state = if (s.optBoolean("running")) "السكالبر يعمل" else "السكالبر متوقف"
      val trades = if (s.has("tradesToday")) " · صفقات اليوم ${s.optInt("tradesToday")}" else ""
      val pnl = if (s.has("dailyPnl")) " · " + String.format(java.util.Locale.US, "%+.2f", s.optDouble("dailyPnl")) else ""
      return state + trades + pnl
    }
  }

  @Volatile private var running = false
  private var worker: Thread? = null
  private val shown = HashSet<String>()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Notifications.ensureChannels(this)
    val first = Notifications.ongoing(this, null, "جارٍ الاتصال بالكمبيوتر…", false)
    val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
    ServiceCompat.startForeground(this, Notifications.ID_ONGOING, first, type)
    if (!running) {
      running = true
      worker = Thread({ loop() }, "layanx-watch").apply { isDaemon = true; start() }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    worker?.interrupt()
    super.onDestroy()
  }

  private fun loop() {
    var cursor = ""
    var backoff = 0L
    var firstFeed = true
    while (running) {
      val d = LxConfig.load(this)
      if (d == null || !LxConfig.watching(this)) {
        stopSelf()
        return
      }
      try {
        val r = LxHttp.call(this, d, "GET", "/v1/companion/feed?wait=25&cursor=" + LxHttp.enc(cursor), null, 40_000)
        if (r.status == 401 || r.status == 403) {
          Notifications.post(this, Notifications.ID_ONGOING, Notifications.ongoing(this, null, "رفض الكمبيوتر هذا الهاتف. اربطه من جديد من صفحة الإعداد.", false))
          sleep(60_000)
          continue
        }
        if (r.status != 200) throw java.io.IOException("HTTP " + r.status)
        val feed = JSONObject(r.body)
        cursor = feed.optString("cursor", "")
        LxConfig.saveFeed(this, r.body)
        handle(feed, firstFeed)
        firstFeed = false
        backoff = 0
      } catch (e: InterruptedException) {
        return
      } catch (e: Exception) {
        backoff = if (backoff == 0L) 5_000 else minOf(backoff * 2, 300_000)
        Notifications.post(this, Notifications.ID_ONGOING, Notifications.ongoing(this, null, "لا يصل الهاتف إلى الكمبيوتر الآن. إعادة المحاولة خلال ${backoff / 1000} ث.", false))
        if (!sleep(backoff)) return
      }
    }
  }

  private fun sleep(ms: Long): Boolean {
    return try {
      Thread.sleep(ms)
      true
    } catch (e: InterruptedException) {
      false
    }
  }

  private fun handle(feed: JSONObject, firstFeed: Boolean) {
    // Approvals: one notification per pending request; gone from the feed = decided elsewhere.
    val approvals = feed.optJSONArray("approvals") ?: JSONArray()
    val current = HashSet<String>()
    for (i in 0 until approvals.length()) {
      val a = approvals.optJSONObject(i) ?: continue
      val id = a.optString("id")
      if (id.isEmpty()) continue
      current.add(id)
      if (shown.add(id)) Notifications.approval(this, a)
    }
    for (id in shown.toList()) {
      if (!current.contains(id)) {
        Notifications.cancel(this, Notifications.approvalId(id))
        shown.remove(id)
      }
    }
    // Jobs: the running one in the ongoing notification; finished ones once, as a result.
    val jobs = feed.optJSONArray("jobs") ?: JSONArray()
    var active: JSONObject? = null
    val announced = LxConfig.announced(this)
    var changed = false
    for (i in 0 until jobs.length()) {
      val j = jobs.optJSONObject(i) ?: continue
      val status = j.optString("status")
      if (ACTIVE.contains(status)) {
        if (active == null) active = j
      } else {
        val key = j.optString("id") + ":" + status
        if (announced.add(key)) {
          changed = true
          // Jobs that finished before the phone started following are history, not news.
          if (!firstFeed) Notifications.result(this, j)
        }
      }
    }
    if (changed) LxConfig.setAnnounced(this, announced)
    val line = listOf(loadLine(feed), scalperLine(feed)).filter { it.isNotEmpty() }.joinToString(" · ")
    Notifications.post(this, Notifications.ID_ONGOING, Notifications.ongoing(this, active, line, true))
    StatusWidget.render(this, feed)
  }
}
