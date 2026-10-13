package com.layanx.nativebridge

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * "Ask LayanX" from the Quick Settings tile or the widget: the phone's speech
 * recognition turns the question into text, the PC answers, the answer arrives as a
 * notification. Questions and reports only: tasks are started from the app.
 */
class VoiceAskActivity : AppCompatActivity() {
  private val speech = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
    val text = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
    if (r.resultCode != RESULT_OK || text.isNullOrBlank()) finish() else ask(text)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (savedInstanceState != null) return
    if (LxConfig.load(this) == null) {
      Toast.makeText(applicationContext, "اربط الهاتف بالكمبيوتر أولاً من تطبيق LayanX", Toast.LENGTH_LONG).show()
      packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
      finish()
      return
    }
    val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ar")
      .putExtra(RecognizerIntent.EXTRA_PROMPT, "اسأل LayanX")
    try {
      speech.launch(i)
    } catch (e: ActivityNotFoundException) {
      Toast.makeText(applicationContext, "لا توجد خدمة للتعرف على الكلام في هذا الهاتف", Toast.LENGTH_LONG).show()
      finish()
    }
  }

  private fun ask(text: String) {
    Toast.makeText(applicationContext, "سؤالك: $text", Toast.LENGTH_SHORT).show()
    val ctx = applicationContext
    Thread {
      val reply = try {
        val d = LxConfig.load(ctx) ?: throw IllegalStateException("الهاتف غير مربوط")
        val body = JSONObject().put("text", text).put("projectId", d.projectId).put("lang", "auto").put("allowTasks", false).toString()
        val r = LxHttp.call(ctx, d, "POST", "/v1/assistant/turn", body, 120_000)
        val json = try { JSONObject(r.body) } catch (e: Exception) { JSONObject() }
        if (r.status == 200) json.optString("reply", "…") else "تعذر الرد: " + json.optString("error", "HTTP " + r.status)
      } catch (e: Exception) {
        "تعذر الوصول إلى الكمبيوتر: " + (e.message ?: "")
      }
      Notifications.ensureChannels(ctx)
      Notifications.assistant(ctx, text, reply)
    }.start()
    finish()
  }
}
