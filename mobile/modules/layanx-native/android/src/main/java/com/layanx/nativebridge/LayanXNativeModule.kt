package com.layanx.nativebridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.UUID

/** The JavaScript side of LayanX Remote talks to the Android parts through this module. */
class LayanXNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LayanXNative")

    // HTTPS to the PC; an IP address must present the pinned certificate.
    AsyncFunction("request") { url: String, pin: String?, token: String?, method: String, path: String, body: String?, timeoutMs: Int ->
      val r = LxHttp.request(url, pin, token, method, path, body, timeoutMs)
      mapOf("status" to r.status, "body" to r.body)
    }

    // The paired PC for the background parts (token encrypted with the Android Keystore).
    AsyncFunction("saveDevice") { json: String ->
      LxConfig.save(context, JSONObject(json))
      StatusWidget.render(context, LxConfig.lastFeed(context))
      true
    }

    AsyncFunction("clearDevice") {
      WatchService.stop(context)
      LxConfig.clear(context)
      StatusWidget.render(context, null)
      true
    }

    AsyncFunction("setWatching") { on: Boolean ->
      LxConfig.setWatching(context, on)
      if (on) WatchService.start(context) else WatchService.stop(context)
      on
    }

    Function("isWatching") {
      LxConfig.watching(context)
    }

    // Approve or reject: the fingerprint screen, then the decision bound to the request's digest.
    AsyncFunction("decide") { approvalJson: String, decision: String, promise: Promise ->
      val key = UUID.randomUUID().toString()
      Pending.put(key) { result -> promise.resolve(result.toString()) }
      context.startActivity(ApprovalActivity.intent(context, JSONObject(approvalJson), decision, key))
    }

    Function("authStatus") {
      Auth.status(context)
    }

    Function("ignoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    AsyncFunction("openBatterySettings") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
        val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.packageName))
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
      }
      true
    }

    AsyncFunction("ask") {
      val i = Intent(context, VoiceAskActivity::class.java)
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(i)
      true
    }
  }
}
