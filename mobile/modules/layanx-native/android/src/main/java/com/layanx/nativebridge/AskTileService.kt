package com.layanx.nativebridge

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/** Quick Settings tile: "Ask LayanX" by voice, from anywhere. */
class AskTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    val tile = qsTile ?: return
    tile.label = "اسأل LayanX"
    tile.state = if (LxConfig.load(this) != null) Tile.STATE_INACTIVE else Tile.STATE_UNAVAILABLE
    tile.updateTile()
  }

  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun { open() } else open()
  }

  @SuppressLint("StartActivityAndCollapseDeprecated")
  private fun open() {
    val intent = Intent(this, VoiceAskActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(PendingIntent.getActivity(this, 11, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(intent)
    }
  }
}
