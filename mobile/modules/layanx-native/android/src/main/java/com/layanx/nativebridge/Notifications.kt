package com.layanx.nativebridge

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/** Every notification LayanX shows on the phone. */
object Notifications {
  const val CH_APPROVAL = "layanx_approvals"
  const val CH_MISSION = "layanx_mission"
  const val CH_RESULT = "layanx_results"
  const val CH_ASSIST = "layanx_assistant"
  const val ID_ONGOING = 4100
  private const val ID_ASSIST = 4101
  private const val ID_SITE = 4102

  private val STATUS = mapOf(
    "queued" to "في الانتظار", "planning" to "يخطط", "running" to "يعمل", "waiting_approval" to "ينتظر موافقتك",
    "verifying" to "تحقق نهائي", "completed" to "اكتملت", "failed" to "توقفت", "cancelled" to "أُلغيت", "budget_exhausted" to "انتهى الوقت"
  )
  private val SITE = Regex("موقع|متجر|صفحة|واجهة|site|web|store|shop|page|landing|app", RegexOption.IGNORE_CASE)

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    nm.createNotificationChannel(NotificationChannel(CH_APPROVAL, "موافقات LayanX", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "طلبات تحتاج موافقتك بالبصمة"
      lockscreenVisibility = Notification.VISIBILITY_PRIVATE
    })
    nm.createNotificationChannel(NotificationChannel(CH_MISSION, "المهمة الجارية", NotificationManager.IMPORTANCE_LOW).apply {
      description = "مرحلة المهمة وتقدمها، وحالة الاتصال بالكمبيوتر"
      setShowBadge(false)
    })
    nm.createNotificationChannel(NotificationChannel(CH_RESULT, "نتائج المهام", NotificationManager.IMPORTANCE_DEFAULT))
    nm.createNotificationChannel(NotificationChannel(CH_ASSIST, "ردود LayanX", NotificationManager.IMPORTANCE_DEFAULT))
  }

  fun approvalId(id: String): Int = 5000 + Math.floorMod(id.hashCode(), 1_000_000)

  fun launchApp(ctx: Context): PendingIntent {
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    return PendingIntent.getActivity(ctx, 1, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  @SuppressLint("MissingPermission")
  fun post(ctx: Context, id: Int, n: Notification) {
    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
    NotificationManagerCompat.from(ctx).notify(id, n)
  }

  fun cancel(ctx: Context, id: Int) {
    NotificationManagerCompat.from(ctx).cancel(id)
  }

  /** A request waiting for the owner: approve or reject, each behind the fingerprint. */
  fun approval(ctx: Context, a: JSONObject) {
    val id = a.optString("id")
    val nid = approvalId(id)
    val tool = a.optString("tool", a.optString("action"))
    val reason = a.optString("reason").ifEmpty { a.optString("action") }
    val approve = PendingIntent.getActivity(ctx, nid, ApprovalActivity.intent(ctx, a, "approve", null), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val reject = PendingIntent.getActivity(ctx, nid + 1, ApprovalActivity.intent(ctx, a, "revoke", null), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val hidden = NotificationCompat.Builder(ctx, CH_APPROVAL)
      .setSmallIcon(R.drawable.ic_layanx_notify)
      .setContentTitle("LayanX ينتظر موافقتك")
      .setContentText("افتح القفل لترى الطلب")
      .build()
    val details = listOf(reason, a.optString("goal"), "المشروع: " + a.optString("projectId", "default")).filter { it.isNotBlank() }.joinToString("\n")
    val n = NotificationCompat.Builder(ctx, CH_APPROVAL)
      .setSmallIcon(R.drawable.ic_layanx_notify)
      .setContentTitle("موافقة مطلوبة: $tool")
      .setContentText(reason)
      .setStyle(NotificationCompat.BigTextStyle().bigText(details))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(hidden)
      .setContentIntent(launchApp(ctx))
      .addAction(0, "موافقة", approve)
      .addAction(0, "رفض", reject)
      .setOnlyAlertOnce(true)
      .build()
    post(ctx, nid, n)
  }

  /** The ongoing notification: the running mission (stage + progress), or the connection state. */
  fun ongoing(ctx: Context, job: JSONObject?, line: String, connected: Boolean): Notification {
    val b = NotificationCompat.Builder(ctx, CH_MISSION)
      .setSmallIcon(R.drawable.ic_layanx_notify)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setContentIntent(launchApp(ctx))
    if (job != null) {
      val total = job.optInt("total", 0)
      val done = job.optInt("done", 0)
      val status = STATUS[job.optString("status")] ?: job.optString("status")
      b.setContentTitle(job.optString("goal", "مهمة"))
        .setContentText(status + " · " + job.optString("stage"))
        .setSubText(if (total > 0) "$done/$total مراحل" else line)
        .setStyle(NotificationCompat.BigTextStyle().bigText(status + " · " + job.optString("stage") + if (line.isNotEmpty()) "\n" + line else ""))
        .setProgress(if (total > 0) total else 1, done, total == 0)
    } else {
      b.setContentTitle(if (connected) "LayanX متصل" else "LayanX غير متصل")
        .setContentText(line.ifEmpty { if (connected) "لا توجد مهمة جارية" else "إعادة المحاولة تلقائياً" })
    }
    return b.build()
  }

  /** A job finished: its result, and "Open the site" on the PC when it built one. */
  fun result(ctx: Context, job: JSONObject) {
    val id = job.optString("id")
    val ok = job.optString("status") == "completed"
    val b = NotificationCompat.Builder(ctx, CH_RESULT)
      .setSmallIcon(R.drawable.ic_layanx_notify)
      .setContentTitle(if (ok) "اكتملت المهمة ✓" else "توقفت المهمة: " + (STATUS[job.optString("status")] ?: job.optString("status")))
      .setContentText(job.optString("goal"))
      .setStyle(NotificationCompat.BigTextStyle().bigText(job.optString("goal") + "\n" + job.optString("result")))
      .setContentIntent(launchApp(ctx))
      .setAutoCancel(true)
    if (ok && (job.optString("preview").isNotEmpty() || SITE.containsMatchIn(job.optString("goal")))) {
      b.addAction(0, "افتح الموقع على الكمبيوتر", ActionReceiver.openSite(ctx, id))
    }
    post(ctx, 6000 + Math.floorMod(id.hashCode(), 1_000_000), b.build())
  }

  fun site(ctx: Context, text: String) {
    post(ctx, ID_SITE, NotificationCompat.Builder(ctx, CH_RESULT).setSmallIcon(R.drawable.ic_layanx_notify)
      .setContentTitle("الموقع").setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text)).setAutoCancel(true).build())
  }

  fun assistant(ctx: Context, question: String, reply: String) {
    post(ctx, ID_ASSIST, NotificationCompat.Builder(ctx, CH_ASSIST).setSmallIcon(R.drawable.ic_layanx_notify)
      .setContentTitle(question.take(80)).setContentText(reply)
      .setStyle(NotificationCompat.BigTextStyle().bigText(reply))
      .setContentIntent(launchApp(ctx)).setAutoCancel(true).build())
  }
}
