package com.layanx.nativebridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * The only place a decision leaves the phone. It always asks for the fingerprint (or the
 * screen lock), then sends the decision with the request's digest, so the PC applies it
 * to exactly the request that was shown, and continues the work by itself.
 * Used by the notification buttons and by the app's own buttons.
 */
class ApprovalActivity : AppCompatActivity() {
  companion object {
    private const val EXTRA_APPROVAL = "approval"
    private const val EXTRA_DECISION = "decision"
    private const val EXTRA_REQUEST = "request"

    fun intent(ctx: Context, approval: JSONObject, decision: String, request: String?): Intent {
      val i = Intent(ctx, ApprovalActivity::class.java)
      i.putExtra(EXTRA_APPROVAL, approval.toString())
      i.putExtra(EXTRA_DECISION, if (decision == "approve") "approve" else "revoke")
      if (request != null) i.putExtra(EXTRA_REQUEST, request)
      // One PendingIntent per request and decision.
      i.data = Uri.parse("layanx-approval://" + Uri.encode(approval.optString("id")) + "/" + decision)
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
      return i
    }
  }

  private var finished = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val approval = try {
      JSONObject(intent.getStringExtra(EXTRA_APPROVAL) ?: "")
    } catch (e: Exception) {
      done(JSONObject().put("ok", false).put("message", "طلب غير صالح"), null)
      return
    }
    val decision = intent.getStringExtra(EXTRA_DECISION) ?: "revoke"
    val ready = Auth.status(this)
    if (ready != androidx.biometric.BiometricManager.BIOMETRIC_SUCCESS) {
      done(JSONObject().put("ok", false).put("message", "فعّل البصمة أو قفل الشاشة في الهاتف أولاً: كل قرار يحتاجها."), null)
      return
    }
    val tool = approval.optString("tool", approval.optString("action"))
    val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        send(approval, decision)
      }

      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        done(JSONObject().put("ok", false).put("cancelled", true).put("message", errString.toString()), null)
      }
    })
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle(if (decision == "approve") "الموافقة على: $tool" else "رفض: $tool")
      .setSubtitle("المشروع: " + approval.optString("projectId", "default"))
      .setDescription(approval.optString("reason").take(300))
      .setAllowedAuthenticators(Auth.authenticators())
      .setConfirmationRequired(true)
      .build()
    prompt.authenticate(info)
  }

  private fun send(approval: JSONObject, decision: String) {
    Thread {
      val result = JSONObject()
      try {
        val d = LxConfig.load(this) ?: throw IllegalStateException("الهاتف غير مربوط بالكمبيوتر")
        val path = "/v1/approvals/" + LxHttp.enc(approval.optString("id")) + "/" + decision + "?projectId=" + LxHttp.enc(approval.optString("projectId", "default"))
        val body = JSONObject().put("digest", approval.optString("digest")).put("resume", decision == "approve").toString()
        val r = LxHttp.call(this, d, "POST", path, body, 20_000)
        val json = try { JSONObject(r.body) } catch (e: Exception) { JSONObject() }
        result.put("ok", r.status == 200).put("status", r.status)
          .put("message", json.optString("message", json.optString("error", "")))
          .put("continuing", json.opt("continuing") ?: JSONObject.NULL)
      } catch (e: Exception) {
        result.put("ok", false).put("message", e.message ?: "تعذر الوصول إلى الكمبيوتر")
      }
      runOnUiThread { done(result, approval) }
    }.start()
  }

  private fun done(result: JSONObject, approval: JSONObject?) {
    if (finished) return
    finished = true
    val ok = result.optBoolean("ok")
    if (ok && approval != null) Notifications.cancel(this, Notifications.approvalId(approval.optString("id")))
    val decision = intent.getStringExtra(EXTRA_DECISION) ?: "revoke"
    val text = when {
      ok && decision == "approve" -> "تمت الموافقة، ويكمل LayanX العمل على الكمبيوتر."
      ok -> "رُفض الطلب."
      result.optInt("status") == 409 -> "تغيّر هذا الطلب منذ ظهوره. راجعه من جديد."
      result.optBoolean("cancelled") -> ""
      else -> "لم يُنفّذ القرار: " + result.optString("message")
    }
    if (text.isNotEmpty()) Toast.makeText(applicationContext, text, Toast.LENGTH_LONG).show()
    Pending.complete(intent.getStringExtra(EXTRA_REQUEST), result)
    finish()
  }

  override fun onDestroy() {
    if (!finished) {
      finished = true
      Pending.complete(intent.getStringExtra(EXTRA_REQUEST), JSONObject().put("ok", false).put("cancelled", true))
    }
    super.onDestroy()
  }
}
