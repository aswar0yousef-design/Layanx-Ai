package com.layanx.nativebridge

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The paired computer, as the background parts need it while the app is closed. */
data class Device(
  val name: String,
  val deviceId: String,
  val urls: List<String>,
  /** SHA-256 of the computer's LAN certificate (base64url), from the QR code. */
  val pin: String?,
  val token: String,
  val projectId: String
)

/**
 * Settings shared by the app, the watch service, the tile and the widget.
 * The device token is encrypted with a key that never leaves the Android Keystore.
 */
object LxConfig {
  private const val PREFS = "layanx_native"
  private const val KEY_ALIAS = "layanx_device_token"

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore")
    ks.load(null)
    val existing = ks.getKey(KEY_ALIAS, null)
    if (existing is SecretKey) return existing
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  private fun encrypt(plain: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val out = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(out, Base64.NO_WRAP)
  }

  private fun decrypt(value: String): String? {
    return try {
      val parts = value.split(":", limit = 2)
      if (parts.size != 2) return null
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
      String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
    } catch (e: Exception) {
      null
    }
  }

  /** {name, deviceId, urls:[...], pin, token, projectId} from the app after pairing. */
  fun save(ctx: Context, json: JSONObject) {
    val urls = json.optJSONArray("urls") ?: JSONArray()
    val clean = JSONArray()
    for (i in 0 until urls.length()) {
      val u = urls.optString(i, "")
      if (u.startsWith("https://")) clean.put(u)
    }
    val token = json.optString("token", "")
    if (token.isEmpty() || clean.length() == 0) throw IllegalArgumentException("A paired device needs a token and an https address.")
    prefs(ctx).edit()
      .putString("name", json.optString("name", "LayanX"))
      .putString("deviceId", json.optString("deviceId", ""))
      .putString("urls", clean.toString())
      .putString("pin", json.optString("pin", ""))
      .putString("projectId", json.optString("projectId", "default").ifEmpty { "default" })
      .putString("token", encrypt(token))
      .apply()
  }

  fun load(ctx: Context): Device? {
    val p = prefs(ctx)
    val enc = p.getString("token", null) ?: return null
    val token = decrypt(enc) ?: return null
    val arr = try { JSONArray(p.getString("urls", "[]")) } catch (e: Exception) { JSONArray() }
    val urls = ArrayList<String>()
    for (i in 0 until arr.length()) urls.add(arr.optString(i))
    if (urls.isEmpty()) return null
    return Device(
      name = p.getString("name", "LayanX") ?: "LayanX",
      deviceId = p.getString("deviceId", "") ?: "",
      urls = urls,
      pin = p.getString("pin", null)?.ifEmpty { null },
      token = token,
      projectId = p.getString("projectId", "default") ?: "default"
    )
  }

  fun clear(ctx: Context) {
    prefs(ctx).edit().clear().apply()
  }

  fun watching(ctx: Context): Boolean = prefs(ctx).getBoolean("watching", false)
  fun setWatching(ctx: Context, on: Boolean) {
    prefs(ctx).edit().putBoolean("watching", on).apply()
  }

  fun lastUrl(ctx: Context): String? = prefs(ctx).getString("lastUrl", null)
  fun setLastUrl(ctx: Context, url: String) {
    prefs(ctx).edit().putString("lastUrl", url).apply()
  }

  fun saveFeed(ctx: Context, body: String) {
    prefs(ctx).edit().putString("feed", body).putLong("feedAt", System.currentTimeMillis()).apply()
  }

  fun lastFeed(ctx: Context): JSONObject? {
    val text = prefs(ctx).getString("feed", null) ?: return null
    return try { JSONObject(text) } catch (e: Exception) { null }
  }

  fun feedAge(ctx: Context): Long = System.currentTimeMillis() - prefs(ctx).getLong("feedAt", 0L)

  /** Results already shown (job id + status), so a restart does not announce them again. */
  fun announced(ctx: Context): MutableSet<String> = HashSet(prefs(ctx).getStringSet("announced", emptySet()) ?: emptySet())
  fun setAnnounced(ctx: Context, keys: Set<String>) {
    prefs(ctx).edit().putStringSet("announced", HashSet(keys.toList().takeLast(200))).apply()
  }
}
