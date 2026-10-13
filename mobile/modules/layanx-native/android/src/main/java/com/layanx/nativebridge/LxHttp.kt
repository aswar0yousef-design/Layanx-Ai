package com.layanx.nativebridge

import android.content.Context
import android.util.Base64
import java.io.IOException
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * HTTPS to the paired computer.
 *
 * On the home network (an IP address) the computer has its own certificate that no
 * authority signed. The phone accepts exactly the certificate whose SHA-256 came in
 * the QR code, and nothing else: another device on the same Wi-Fi cannot answer in
 * its place. Names such as *.ts.net have real certificates and use the system's
 * normal checks. Plain http is never used, so the device token never travels in clear.
 */
object LxHttp {
  class Response(val status: Int, val body: String)

  private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

  fun isIpLiteral(host: String): Boolean = IPV4.matches(host) || host.contains(":")

  fun decodePin(pin: String): ByteArray = Base64.decode(pin, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

  private fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

  private class PinnedTrustManager(private val pin: ByteArray) : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      throw CertificateException("LayanX does not use client certificates")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      val leaf = chain?.firstOrNull() ?: throw CertificateException("The computer sent no certificate")
      if (!MessageDigest.isEqual(sha256(leaf.encoded), pin)) {
        throw CertificateException("This is not your LayanX computer: its certificate fingerprint is different")
      }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
  }

  private val factories = HashMap<String, SSLSocketFactory>()

  @Synchronized
  private fun pinnedFactory(pin: String): SSLSocketFactory {
    factories[pin]?.let { return it }
    val context = SSLContext.getInstance("TLS")
    context.init(null, arrayOf<TrustManager>(PinnedTrustManager(decodePin(pin))), SecureRandom())
    return context.socketFactory.also { factories[pin] = it }
  }

  /** The pinned certificate stands in for the host name, which changes with the network. */
  private fun pinnedVerifier(pin: String): HostnameVerifier {
    val expected = decodePin(pin)
    return HostnameVerifier { _, session ->
      try {
        val cert = session.peerCertificates.firstOrNull()
        cert != null && MessageDigest.isEqual(sha256(cert.encoded), expected)
      } catch (e: Exception) {
        false
      }
    }
  }

  fun request(base: String, pin: String?, token: String?, method: String, path: String, body: String?, timeoutMs: Int): Response {
    val url = URL(base.trimEnd('/') + path)
    if (url.protocol != "https") throw IOException("LayanX only talks to the computer over https")
    val conn = url.openConnection() as HttpsURLConnection
    if (isIpLiteral(url.host)) {
      if (pin.isNullOrEmpty()) throw IOException("Pair again with the QR code: this address needs the computer's certificate fingerprint")
      conn.sslSocketFactory = pinnedFactory(pin)
      conn.hostnameVerifier = pinnedVerifier(pin)
    }
    try {
      conn.requestMethod = method
      conn.connectTimeout = minOf(timeoutMs, 8000)
      conn.readTimeout = timeoutMs
      conn.useCaches = false
      conn.setRequestProperty("Accept", "application/json")
      if (!token.isNullOrEmpty()) conn.setRequestProperty("Authorization", "Bearer $token")
      if (body != null) {
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      }
      val status = conn.responseCode
      val stream = if (status >= 400) conn.errorStream else conn.inputStream
      val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
      return Response(status, text)
    } finally {
      conn.disconnect()
    }
  }

  /** Tries the address that answered last, then the others (home Wi-Fi, Tailscale, tunnel). */
  fun call(ctx: Context, d: Device, method: String, path: String, body: String?, timeoutMs: Int): Response {
    val last = LxConfig.lastUrl(ctx)
    val order = ArrayList<String>()
    if (last != null && d.urls.contains(last)) order.add(last)
    for (u in d.urls) if (!order.contains(u)) order.add(u)
    var error: Exception? = null
    for (u in order) {
      try {
        val r = request(u, d.pin, d.token, method, path, body, timeoutMs)
        if (u != last) LxConfig.setLastUrl(ctx, u)
        return r
      } catch (e: Exception) {
        // A certificate that does not match (another network with the same address) is skipped like an unreachable one.
        error = e
      }
    }
    throw error ?: IOException("No address for the computer")
  }

  fun enc(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")
}

/** Calls waiting for an approval screen to finish (the in-app approve button). */
object Pending {
  private val callbacks = java.util.concurrent.ConcurrentHashMap<String, (org.json.JSONObject) -> Unit>()
  fun put(key: String, cb: (org.json.JSONObject) -> Unit) {
    callbacks[key] = cb
  }
  fun complete(key: String?, result: org.json.JSONObject) {
    if (key != null) callbacks.remove(key)?.invoke(result)
  }
}

/** Fingerprint (or face) with the screen lock as the fallback; strong biometrics where Android offers the combination. */
object Auth {
  fun authenticators(): Int =
    if (android.os.Build.VERSION.SDK_INT >= 30)
      androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG or androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
    else
      androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK or androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL

  /** 0 = ready (BiometricManager.BIOMETRIC_SUCCESS). */
  fun status(ctx: Context): Int = androidx.biometric.BiometricManager.from(ctx).canAuthenticate(authenticators())
}
