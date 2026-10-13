package com.layanx.nativebridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a restart (or an app update) the phone keeps following the PC if the owner turned that on. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (LxConfig.watching(context) && LxConfig.load(context) != null) {
      try {
        WatchService.start(context)
      } catch (e: Exception) {
        // Android may refuse a background start; the app starts it the next time it opens.
      }
    }
  }
}
