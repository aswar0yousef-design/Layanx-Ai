package expo.modules.layanxnative;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.interfaces.ECPublicKey;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Talks to one paired PC over the encrypted link: pairing from the QR link, then requests. Every
 * address the PC gave (home Wi-Fi, Tailscale, tunnel) is tried, the last one that worked first.
 * Plain JDK (HttpURLConnection), so it is tested on a desktop JVM against the real PC code.
 */
public final class LinkClient {
    private LinkClient() {}

    /** A paired PC. privateKey is this phone's key for that PC (PKCS#8, base64url); keep it secret. */
    public static final class Device {
        public String id, name, computer, installId, pcKey, privateKey, lastUrl;
        public List<String> urls = new ArrayList<>();

        public Map<String, Object> toMap(boolean withSecret) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("name", name);
            m.put("computer", computer);
            m.put("installId", installId);
            m.put("pcKey", pcKey);
            m.put("lastUrl", lastUrl);
            m.put("urls", new ArrayList<Object>(urls));
            if (withSecret) m.put("privateKey", privateKey);
            return m;
        }

        @SuppressWarnings("unchecked")
        public static Device fromMap(Map<String, Object> m) {
            Device d = new Device();
            d.id = MiniJson.str(m, "id");
            d.name = MiniJson.str(m, "name");
            d.computer = MiniJson.str(m, "computer");
            d.installId = MiniJson.str(m, "installId");
            d.pcKey = MiniJson.str(m, "pcKey");
            d.privateKey = MiniJson.str(m, "privateKey");
            d.lastUrl = MiniJson.str(m, "lastUrl");
            Object u = m.get("urls");
            if (u instanceof List) for (Object o : (List<Object>) u) if (o != null) d.urls.add(o.toString());
            return d;
        }
    }

    public static final class Response {
        public int status;
        public String contentType, body;
        public boolean base64;
    }

    /** The PC refused this phone: it was removed or never paired. Pair again. */
    public static final class DeviceRemovedException extends IOException {
        public DeviceRemovedException(String m) { super(m); }
    }

    public static final class PairingLink {
        public String pcKey, code, computer;
        public List<String> urls = new ArrayList<>();
    }

    public static PairingLink parseLink(String link) throws Exception {
        String t = link == null ? "" : link.trim();
        if (!t.startsWith("layanx://pair?")) throw new IllegalArgumentException("Not a LayanX pairing code");
        PairingLink p = new PairingLink();
        String version = null;
        for (String part : t.substring("layanx://pair?".length()).split("&")) {
            int eq = part.indexOf('=');
            if (eq < 0) continue;
            String k = part.substring(0, eq), v = part.substring(eq + 1);
            switch (k) {
                case "v": version = v; break;
                case "k": p.pcKey = v; break;
                case "c": p.code = URLDecoder.decode(v, "UTF-8"); break;
                case "n": p.computer = URLDecoder.decode(v, "UTF-8"); break;
                case "u":
                    for (String u : v.split(",")) {
                        String url = URLDecoder.decode(u, "UTF-8");
                        if (url.startsWith("http://") || url.startsWith("https://")) p.urls.add(url.replaceAll("/+$", ""));
                    }
                    break;
                default: break;
            }
        }
        if (!"2".equals(version) || p.pcKey == null || p.code == null || p.urls.isEmpty())
            throw new IllegalArgumentException("This pairing code is incomplete or from another LayanX version");
        LinkCrypto.decodePoint(LinkCrypto.B64.dec(p.pcKey));
        return p;
    }

    private static final class Http {
        int status;
        String body;
    }

    private static Http post(String url, String json, int timeoutMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(Math.min(timeoutMs, 8000));
            c.setReadTimeout(timeoutMs);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Accept", "application/json");
            byte[] payload = json.getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(payload.length);
            try (OutputStream o = c.getOutputStream()) { o.write(payload); }
            Http h = new Http();
            h.status = c.getResponseCode();
            InputStream in = h.status >= 400 ? c.getErrorStream() : c.getInputStream();
            h.body = in == null ? "" : read(in);
            return h;
        } finally {
            c.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = s.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > 24 * 1024 * 1024) throw new IOException("Answer too large");
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static String message(String body, String fallback) {
        try {
            Map<String, Object> m = MiniJson.object(body);
            String msg = MiniJson.str(m, "message");
            return msg != null ? msg : fallback;
        } catch (Exception e) {
            return fallback;
        }
    }

    /** Pairs with the PC in the link. The pairing code and this phone's key travel encrypted to the PC's key. */
    public static Device pair(String link, String phoneName) throws Exception {
        PairingLink p = parseLink(link);
        KeyPair kp = LinkCrypto.generate();
        byte[] phonePoint = LinkCrypto.encodePoint((ECPublicKey) kp.getPublic());
        byte[] pcPoint = LinkCrypto.B64.dec(p.pcKey);
        byte[] key = LinkCrypto.pairKey(LinkCrypto.ecdh(kp.getPrivate(), pcPoint), phonePoint, pcPoint);
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("code", p.code);
        inner.put("name", phoneName);
        String[] sealed = LinkCrypto.seal(key, MiniJson.stringify(inner).getBytes(StandardCharsets.UTF_8), LinkCrypto.PAIR_AAD);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("v", 2);
        body.put("pk", LinkCrypto.B64.enc(phonePoint));
        body.put("n", sealed[0]);
        body.put("c", sealed[1]);
        String json = MiniJson.stringify(body);
        IOException lastNetwork = null;
        for (String url : p.urls) {
            Http h;
            try {
                h = post(url + "/v1/link/pair", json, 15000);
            } catch (IOException e) {
                lastNetwork = e;
                continue;
            }
            if (h.status != 200) throw new IOException(message(h.body, "Pairing failed (HTTP " + h.status + ")"));
            Map<String, Object> env = MiniJson.object(h.body);
            // Only the PC that holds the key in the QR code can write this answer.
            Map<String, Object> ok = MiniJson.object(new String(LinkCrypto.open(key, MiniJson.str(env, "n"), MiniJson.str(env, "c"), LinkCrypto.PAIR_OK_AAD), StandardCharsets.UTF_8));
            Device d = new Device();
            d.id = MiniJson.str(ok, "deviceId");
            d.installId = MiniJson.str(ok, "installId");
            d.computer = MiniJson.str(ok, "computer");
            if (d.computer == null) d.computer = p.computer;
            d.name = d.computer;
            d.pcKey = p.pcKey;
            d.privateKey = LinkCrypto.B64.enc(kp.getPrivate().getEncoded());
            d.lastUrl = url;
            d.urls.add(url);
            Object addresses = ok.get("addresses");
            if (addresses instanceof List) for (Object a : (List<?>) addresses) if (a != null && !d.urls.contains(a.toString())) d.urls.add(a.toString());
            for (String u : p.urls) if (!d.urls.contains(u)) d.urls.add(u);
            return d;
        }
        throw new IOException("Cannot reach the computer at " + p.urls + (lastNetwork != null ? ": " + lastNetwork.getMessage() : "")
                + ". Check that the phone is on the same Wi-Fi (or Tailscale is on) and phone access is allowed on the PC.");
    }

    /** The encrypted body of one request (exposed so the tests can replay or tamper with it). */
    public static final class Envelope {
        public String json, requestId;
    }

    public static Envelope envelope(Device d, String method, String path, String body, String bodyType, boolean base64) throws Exception {
        PrivateKey own = LinkCrypto.privateFromPkcs8(LinkCrypto.B64.dec(d.privateKey));
        byte[] shared = LinkCrypto.ecdh(own, LinkCrypto.B64.dec(d.pcKey));
        Map<String, Object> inner = new LinkedHashMap<>();
        inner.put("m", method);
        inner.put("p", path);
        if (body != null) {
            inner.put("b", body);
            inner.put("bt", bodyType == null ? "application/json" : bodyType);
            if (base64) inner.put("b64", true);
        }
        inner.put("t", System.currentTimeMillis());
        String rid = LinkCrypto.randomId();
        inner.put("r", rid);
        String[] sealed = LinkCrypto.seal(LinkCrypto.c2s(shared, d.id), MiniJson.stringify(inner).getBytes(StandardCharsets.UTF_8), LinkCrypto.requestAad(d.id));
        Map<String, Object> outer = new LinkedHashMap<>();
        outer.put("v", 2);
        outer.put("d", d.id);
        outer.put("n", sealed[0]);
        outer.put("c", sealed[1]);
        Envelope e = new Envelope();
        e.json = MiniJson.stringify(outer);
        e.requestId = rid;
        return e;
    }

    /** Sends one envelope to one address and reads the answer (HTTP status of the link itself in status on errors). */
    public static Response send(Device d, String url, Envelope e, int timeoutMs) throws Exception {
        Http h = post(url + "/v1/link", e.json, timeoutMs);
        if (h.status == 401) throw new DeviceRemovedException(message(h.body, "This phone was removed from the computer. Pair it again."));
        if (h.status != 200) {
            Response r = new Response();
            r.status = h.status;
            r.contentType = "application/json";
            r.body = h.body;
            return r;
        }
        Map<String, Object> env = MiniJson.object(h.body);
        byte[] shared = LinkCrypto.ecdh(LinkCrypto.privateFromPkcs8(LinkCrypto.B64.dec(d.privateKey)), LinkCrypto.B64.dec(d.pcKey));
        Map<String, Object> inner = MiniJson.object(new String(LinkCrypto.open(LinkCrypto.s2c(shared, d.id), MiniJson.str(env, "n"), MiniJson.str(env, "c"),
                LinkCrypto.responseAad(d.id, e.requestId)), StandardCharsets.UTF_8));
        Response r = new Response();
        Object s = inner.get("s");
        r.status = s instanceof Number ? ((Number) s).intValue() : 502;
        r.contentType = MiniJson.str(inner, "ct");
        r.body = MiniJson.str(inner, "b");
        r.base64 = Boolean.TRUE.equals(inner.get("b64"));
        return r;
    }

    /**
     * One request, tried on each address (last good one first) until one answers. A network error moves
     * on to the next address; any answer from the PC, even an error, ends the search. The address that
     * answered is stored in d.lastUrl.
     */
    public static Response request(Device d, String method, String path, String body, String bodyType, boolean base64, int timeoutMs) throws Exception {
        List<String> order = new ArrayList<>();
        if (d.lastUrl != null) order.add(d.lastUrl);
        for (String u : d.urls) if (!order.contains(u)) order.add(u);
        IOException last = null;
        for (String url : order) {
            Envelope e = envelope(d, method, path, body, bodyType, base64);
            try {
                Response r = send(d, url, e, timeoutMs);
                d.lastUrl = url;
                return r;
            } catch (DeviceRemovedException removed) {
                throw removed;
            } catch (IOException network) {
                last = network;
            }
        }
        throw new IOException("Cannot reach " + (d.computer != null ? d.computer : "the computer") + (last != null ? ": " + last.getMessage() : ""));
    }
}
