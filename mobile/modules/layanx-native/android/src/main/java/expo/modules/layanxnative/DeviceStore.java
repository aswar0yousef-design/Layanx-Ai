package expo.modules.layanxnative;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The paired PCs, kept on this phone only. The list holds each PC's link key and this phone's private
 * key for it, so it is encrypted with an AES key that lives in the Android Keystore (it never leaves the
 * secure hardware). The live-updates service reads it too, without the JavaScript side running.
 */
public final class DeviceStore {
    private static final String PREFS = "layanx_link";
    private static final String ALIAS = "layanx_device_store";
    private DeviceStore() {}

    private static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return g.generateKey();
    }

    private static String seal(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] body = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return LinkCrypto.B64.enc(c.getIV()) + "." + LinkCrypto.B64.enc(body);
    }

    private static String open(String sealed) throws Exception {
        int dot = sealed.indexOf('.');
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, LinkCrypto.B64.dec(sealed.substring(0, dot))));
        return new String(c.doFinal(LinkCrypto.B64.dec(sealed.substring(dot + 1))), StandardCharsets.UTF_8);
    }

    @SuppressWarnings("unchecked")
    public static synchronized List<LinkClient.Device> list(Context ctx) {
        List<LinkClient.Device> out = new ArrayList<>();
        String sealed = prefs(ctx).getString("devices", null);
        if (sealed == null) return out;
        try {
            Object parsed = MiniJson.parse(open(sealed));
            if (parsed instanceof List) for (Object o : (List<Object>) parsed) if (o instanceof Map) out.add(LinkClient.Device.fromMap((Map<String, Object>) o));
        } catch (Exception e) {
            // Unreadable (the Keystore key was reset): the phone has to pair again.
        }
        return out;
    }

    public static synchronized void save(Context ctx, List<LinkClient.Device> devices) throws Exception {
        List<Object> raw = new ArrayList<>();
        for (LinkClient.Device d : devices) raw.add(d.toMap(true));
        prefs(ctx).edit().putString("devices", seal(MiniJson.stringify(raw))).apply();
    }

    public static synchronized LinkClient.Device get(Context ctx, String id) {
        for (LinkClient.Device d : list(ctx)) if (d.id != null && d.id.equals(id)) return d;
        return null;
    }

    /** Adds a paired PC; pairing the same PC again (same install) replaces the old entry. */
    public static synchronized void put(Context ctx, LinkClient.Device device) throws Exception {
        List<LinkClient.Device> all = list(ctx);
        List<LinkClient.Device> next = new ArrayList<>();
        for (LinkClient.Device d : all) {
            boolean same = d.id.equals(device.id) || (d.installId != null && d.installId.equals(device.installId));
            if (!same) next.add(d);
        }
        next.add(device);
        save(ctx, next);
    }

    /** Remembers the address that answered last, so the next request tries it first. */
    public static synchronized void touch(Context ctx, LinkClient.Device device) {
        try {
            List<LinkClient.Device> all = list(ctx);
            boolean changed = false;
            for (LinkClient.Device d : all) if (d.id.equals(device.id) && device.lastUrl != null && !device.lastUrl.equals(d.lastUrl)) { d.lastUrl = device.lastUrl; changed = true; }
            if (changed) save(ctx, all);
        } catch (Exception ignored) { }
    }

    public static synchronized void remove(Context ctx, String id) throws Exception {
        List<LinkClient.Device> next = new ArrayList<>();
        for (LinkClient.Device d : list(ctx)) if (!d.id.equals(id)) next.add(d);
        save(ctx, next);
        if (id.equals(selectedId(ctx))) prefs(ctx).edit().remove("selected").apply();
    }

    public static String selectedId(Context ctx) { return prefs(ctx).getString("selected", null); }
    public static void select(Context ctx, String id) { prefs(ctx).edit().putString("selected", id).apply(); }

    /** The PC the app and the live updates follow: the selected one, else the first. */
    public static LinkClient.Device selected(Context ctx) {
        List<LinkClient.Device> all = list(ctx);
        String id = selectedId(ctx);
        for (LinkClient.Device d : all) if (d.id.equals(id)) return d;
        return all.isEmpty() ? null : all.get(0);
    }

    public static boolean live(Context ctx) { return prefs(ctx).getBoolean("live", false); }
    public static void setLive(Context ctx, boolean on) { prefs(ctx).edit().putBoolean("live", on).apply(); }

    /** What the home-screen widget shows (no secrets: titles and counts). */
    public static void saveWidget(Context ctx, String title, String line1, String line2, int badge) {
        prefs(ctx).edit().putString("w_title", title).putString("w_line1", line1).putString("w_line2", line2).putInt("w_badge", badge).apply();
    }
    public static String[] widget(Context ctx) {
        SharedPreferences p = prefs(ctx);
        return new String[] { p.getString("w_title", "LayanX"), p.getString("w_line1", null), p.getString("w_line2", ""), String.valueOf(p.getInt("w_badge", 0)) };
    }
}
