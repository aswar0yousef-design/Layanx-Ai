package expo.modules.layanxnative

import android.content.Context
import androidx.fragment.app.FragmentActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

/**
 * The JavaScript side of the app reaches the PC only through here: pairing from the QR code, encrypted
 * requests, live updates, the fingerprint check and the microphone. Keys never reach JavaScript.
 */
class LayanxNativeModule : Module() {
  // Network calls run on their own threads: a 25-second long-poll must not hold up a decision.
  private val io = Executors.newCachedThreadPool()

  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw CodedException("ERR_NO_CONTEXT", "Android is not ready yet", null)

  private fun background(promise: Promise, work: () -> Any?) {
    io.execute {
      try {
        promise.resolve(work())
      } catch (e: LinkClient.DeviceRemovedException) {
        promise.reject("ERR_DEVICE_REMOVED", e.message ?: "This phone was removed from the computer", e)
      } catch (e: Exception) {
        promise.reject("ERR_LAYANX", e.message ?: e.toString(), e)
      }
    }
  }

  private fun publicDevice(d: LinkClient.Device): Map<String, Any?> =
    mapOf("id" to d.id, "name" to (d.name ?: d.computer), "computer" to d.computer, "installId" to d.installId, "lastUrl" to d.lastUrl, "urls" to d.urls.toList())

  private fun device(id: String?): LinkClient.Device =
    (if (id.isNullOrEmpty()) DeviceStore.selected(context) else DeviceStore.get(context, id))
      ?: throw CodedException("ERR_NOT_PAIRED", "No computer is paired with this phone yet", null)

  override fun definition() = ModuleDefinition {
    Name("LayanxNative")

    OnCreate {
      appContext.reactContext?.let { Notify.channels(it.applicationContext) }
    }

    AsyncFunction("pair") { link: String, phoneName: String, promise: Promise ->
      background(promise) {
        val d = LinkClient.pair(link, phoneName)
        DeviceStore.put(context, d)
        DeviceStore.select(context, d.id)
        publicDevice(d)
      }
    }

    AsyncFunction("devices") {
      mapOf("devices" to DeviceStore.list(context).map { publicDevice(it) }, "selected" to DeviceStore.selected(context)?.id, "live" to DeviceStore.live(context))
    }

    AsyncFunction("select") { id: String ->
      DeviceStore.select(context, id)
      true
    }

    AsyncFunction("removeDevice") { id: String ->
      DeviceStore.remove(context, id)
      if (DeviceStore.selected(context) == null) {
        DeviceStore.setLive(context, false)
        CompanionService.stop(context)
        Notify.clear(context)
      }
      true
    }

    /** One request through the encrypted link: {deviceId?, method, path, body?, bodyType?, base64?, timeoutMs?}. */
    AsyncFunction("request") { options: Map<String, Any?>, promise: Promise ->
      background(promise) {
        val d = device(options["deviceId"] as? String)
        val r = LinkClient.request(
          d,
          (options["method"] as? String) ?: "GET",
          options["path"] as? String ?: throw IllegalArgumentException("path is required"),
          options["body"] as? String,
          options["bodyType"] as? String,
          options["base64"] == true,
          ((options["timeoutMs"] as? Number)?.toInt()) ?: 20000
        )
        DeviceStore.touch(context, d)
        mapOf("status" to r.status, "contentType" to r.contentType, "body" to r.body, "base64" to r.base64, "url" to d.lastUrl)
      }
    }

    AsyncFunction("setLive") { on: Boolean ->
      DeviceStore.setLive(context, on)
      if (on) CompanionService.start(context) else {
        CompanionService.stop(context)
        Notify.clear(context)
      }
      on
    }

    /** "ok", "cancelled", or "unavailable" (no screen lock on this phone: ask for a plain confirmation). */
    AsyncFunction("authenticate") { title: String, subtitle: String?, promise: Promise ->
      val activity = appContext.currentActivity as? FragmentActivity
      if (activity == null) promise.resolve(Auth.UNAVAILABLE)
      else Auth.confirm(activity, title, subtitle) { outcome -> promise.resolve(outcome) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("startRecording") {
      VoiceRecorder.start()
      true
    }

    AsyncFunction("stopRecording") {
      val r = VoiceRecorder.stop()
      if (r == null) null else mapOf("base64" to r[0], "durationMs" to (r[1] as Long).toDouble())
    }

    AsyncFunction("cancelRecording") {
      VoiceRecorder.cancel()
      true
    }

    OnDestroy {
      VoiceRecorder.cancel()
      io.shutdown()
    }
  }
}
