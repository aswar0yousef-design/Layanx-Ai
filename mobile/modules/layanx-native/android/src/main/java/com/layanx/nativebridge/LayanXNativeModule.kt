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

    // Opens the first installed app of the list. Android stops a background app from doing this, so it runs from the open app only.
    AsyncFunction("openApp") { packages: List<String> ->
      val launch = packages.firstNotNullOfOrNull { context.packageManager.getLaunchIntentForPackage(it) }
      if (launch != null) {
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launch)
      }
      launch != null
    }

    // Prepares a message. Sending stays with the person holding the phone.
    AsyncFunction("openWhatsApp") { phone: String?, text: String? ->
      val target = listOf("com.whatsapp", "com.whatsapp.w4b").firstOrNull { context.packageManager.getLaunchIntentForPackage(it) != null }
      if (target != null) {
        val query = if (text.isNullOrBlank()) "" else "?text=" + Uri.encode(text)
        val i = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + (phone ?: "") + query))
        i.setPackage(target)
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
      }
      target != null
    }

    // Notes kept on this phone, encrypted with a key that never leaves the Android Keystore.
    AsyncFunction("memoryLoad") {
      LxConfig.loadMemory(context)
    }

    AsyncFunction("memorySave") { json: String ->
      LxConfig.saveMemory(context, json)
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
