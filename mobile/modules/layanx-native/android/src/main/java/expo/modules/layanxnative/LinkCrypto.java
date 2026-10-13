package expo.modules.layanxnative;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.security.spec.PKCS8EncodedKeySpec;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * The phone side of the LayanX encrypted link (version 2); the PC side is src/security/phone-link.ts.
 * P-256 ECDH, HKDF-SHA256, AES-256-GCM (12-byte nonce, tag appended). Only JDK classes that Android
 * has had since its early versions, so the same file runs in the app and in the desktop test.
 */
public final class LinkCrypto {
    public static final String PAIR_AAD = "layanx/v2/pair";
    public static final String PAIR_OK_AAD = "layanx/v2/pair-ok";
    private static final SecureRandom RANDOM = new SecureRandom();

    private LinkCrypto() {}

    public static String requestAad(String deviceId) { return "layanx/v2/req|" + deviceId; }
    public static String responseAad(String deviceId, String requestId) { return "layanx/v2/res|" + deviceId + "|" + requestId; }

    public static KeyPair generate() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec("secp256r1"), RANDOM);
        return g.generateKeyPair();
    }

    private static ECParameterSpec p256() throws Exception {
        AlgorithmParameters p = AlgorithmParameters.getInstance("EC");
        p.init(new ECGenParameterSpec("secp256r1"));
        return p.getParameterSpec(ECParameterSpec.class);
    }

    private static byte[] fixed32(BigInteger v) {
        byte[] raw = v.toByteArray();
        byte[] out = new byte[32];
        int copy = Math.min(raw.length, 32);
        System.arraycopy(raw, raw.length - copy, out, 32 - copy, copy);
        return out;
    }

    /** 0x04 || X || Y, as the PC's createECDH().getPublicKey() writes it. */
    public static byte[] encodePoint(ECPublicKey key) {
        byte[] out = new byte[65];
        out[0] = 4;
        System.arraycopy(fixed32(key.getW().getAffineX()), 0, out, 1, 32);
        System.arraycopy(fixed32(key.getW().getAffineY()), 0, out, 33, 32);
        return out;
    }

    public static ECPublicKey decodePoint(byte[] point) throws Exception {
        if (point == null || point.length != 65 || point[0] != 4) throw new IllegalArgumentException("Bad public key");
        byte[] x = new byte[32], y = new byte[32];
        System.arraycopy(point, 1, x, 0, 32);
        System.arraycopy(point, 33, y, 0, 32);
        ECPoint w = new ECPoint(new BigInteger(1, x), new BigInteger(1, y));
        // An invalid point is rejected here or by the key agreement.
        return (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(w, p256()));
    }

    public static PrivateKey privateFromPkcs8(byte[] pkcs8) throws Exception {
        return KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
    }

    /** The shared X coordinate (32 bytes), the same value as Node's ecdh.computeSecret(). */
    public static byte[] ecdh(PrivateKey own, byte[] peerPoint) throws Exception {
        KeyAgreement ka = KeyAgreement.getInstance("ECDH");
        ka.init(own);
        ka.doPhase(decodePoint(peerPoint), true);
        return ka.generateSecret();
    }

    private static byte[] hmac(byte[] key, byte[] data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    /** RFC 5869 HKDF-SHA256. */
    public static byte[] hkdf(byte[] ikm, String salt, byte[] info, int length) throws Exception {
        byte[] prk = hmac(salt.getBytes(StandardCharsets.UTF_8), ikm);
        byte[] out = new byte[length];
        byte[] t = new byte[0];
        int pos = 0;
        for (int counter = 1; pos < length; counter++) {
            byte[] input = new byte[t.length + info.length + 1];
            System.arraycopy(t, 0, input, 0, t.length);
            System.arraycopy(info, 0, input, t.length, info.length);
            input[input.length - 1] = (byte) counter;
            t = hmac(prk, input);
            int n = Math.min(t.length, length - pos);
            System.arraycopy(t, 0, out, pos, n);
            pos += n;
        }
        return out;
    }

    public static byte[] pairKey(byte[] shared, byte[] phonePoint, byte[] pcPoint) throws Exception {
        byte[] info = new byte[phonePoint.length + pcPoint.length];
        System.arraycopy(phonePoint, 0, info, 0, phonePoint.length);
        System.arraycopy(pcPoint, 0, info, phonePoint.length, pcPoint.length);
        return hkdf(shared, "layanx-link/v2/pair", info, 32);
    }

    public static byte[] c2s(byte[] shared, String deviceId) throws Exception {
        return hkdf(shared, "layanx-link/v2", ("c2s:" + deviceId).getBytes(StandardCharsets.UTF_8), 32);
    }

    public static byte[] s2c(byte[] shared, String deviceId) throws Exception {
        return hkdf(shared, "layanx-link/v2", ("s2c:" + deviceId).getBytes(StandardCharsets.UTF_8), 32);
    }

    /** {nonce, ciphertext+tag}, both base64url. */
    public static String[] seal(byte[] key, byte[] plain, String aad) throws Exception {
        byte[] nonce = new byte[12];
        RANDOM.nextBytes(nonce);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
        c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        return new String[] { B64.enc(nonce), B64.enc(c.doFinal(plain)) };
    }

    public static byte[] open(byte[] key, String nonce, String body, String aad) throws Exception {
        byte[] n = B64.dec(nonce), b = B64.dec(body);
        if (n.length != 12 || b.length < 16) throw new IllegalArgumentException("Bad envelope");
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, n));
        c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
        return c.doFinal(b);
    }

    public static String randomId() {
        byte[] r = new byte[18];
        RANDOM.nextBytes(r);
        return B64.enc(r);
    }

    /** Base64url without padding (java.util.Base64 needs Android 8; this works everywhere). */
    public static final class B64 {
        private static final char[] A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toCharArray();
        private static final int[] R = new int[128];
        static {
            java.util.Arrays.fill(R, -1);
            for (int k = 0; k < A.length; k++) R[A[k]] = k;
            R['+'] = 62;
            R['/'] = 63;
        }

        public static String enc(byte[] data) {
            StringBuilder b = new StringBuilder((data.length * 4 + 2) / 3);
            int k = 0;
            for (; k + 2 < data.length; k += 3) {
                int v = ((data[k] & 0xff) << 16) | ((data[k + 1] & 0xff) << 8) | (data[k + 2] & 0xff);
                b.append(A[(v >> 18) & 63]).append(A[(v >> 12) & 63]).append(A[(v >> 6) & 63]).append(A[v & 63]);
            }
            int rest = data.length - k;
            if (rest == 1) {
                int v = (data[k] & 0xff) << 16;
                b.append(A[(v >> 18) & 63]).append(A[(v >> 12) & 63]);
            } else if (rest == 2) {
                int v = ((data[k] & 0xff) << 16) | ((data[k + 1] & 0xff) << 8);
                b.append(A[(v >> 18) & 63]).append(A[(v >> 12) & 63]).append(A[(v >> 6) & 63]);
            }
            return b.toString();
        }

        /** Accepts base64url or standard base64, with or without padding. */
        public static byte[] dec(String text) {
            if (text == null) return new byte[0];
            String t = text.trim();
            int len = t.length();
            while (len > 0 && t.charAt(len - 1) == '=') len--;
            byte[] out = new byte[len * 3 / 4];
            int acc = 0, bits = 0, pos = 0;
            for (int k = 0; k < len; k++) {
                char ch = t.charAt(k);
                int v = ch < 128 ? R[ch] : -1;
                if (v < 0) throw new IllegalArgumentException("Bad base64");
                acc = (acc << 6) | v;
                bits += 6;
                if (bits >= 8) {
                    bits -= 8;
                    if (pos < out.length) out[pos++] = (byte) ((acc >> bits) & 0xff);
                }
            }
            return pos == out.length ? out : java.util.Arrays.copyOf(out, pos);
        }
    }
}
