import expo.modules.layanxnative.LinkClient;
import expo.modules.layanxnative.MiniJson;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Runs the phone's link code (the same Java files the Android app ships) against a real LayanX gateway:
 *   java LinkCheck <pairing link>
 * Prints one JSON object with what happened, for tests/phone-link.spec.ts.
 */
public final class LinkCheck {
    public static void main(String[] args) throws Exception {
        Map<String, Object> out = new LinkedHashMap<>();
        LinkClient.Device d = LinkClient.pair(args[0], "هاتف الاختبار");
        out.put("deviceId", d.id);
        out.put("computer", d.computer);
        LinkClient.Response who = LinkClient.request(d, "GET", "/v1/device/whoami", null, null, false, 15000);
        out.put("whoami", MiniJson.parse(who.body));
        LinkClient.Response echo = LinkClient.request(d, "POST", "/v1/echo?x=1", "{\"text\":\"مرحبا\"}", "application/json", false, 15000);
        out.put("echoStatus", echo.status);
        out.put("echo", MiniJson.parse(echo.body));
        LinkClient.Response audio = LinkClient.request(d, "POST", "/v1/echo-binary", "AAECAwQ=", "audio/wav", true, 15000);
        out.put("audio", MiniJson.parse(audio.body));
        // The same envelope twice: the second must be refused (no replay).
        LinkClient.Envelope e = LinkClient.envelope(d, "GET", "/v1/device/whoami", null, null, false);
        out.put("first", LinkClient.send(d, d.lastUrl, e, 15000).status);
        out.put("replay", LinkClient.send(d, d.lastUrl, e, 15000).status);
        out.put("device", d.toMap(false));
        if (args.length >= 4) {
            String good = d.lastUrl;
            // An address now answered by something else saying "unknown device": not proof, try the next one.
            d.urls.add(0, args[1]);
            d.lastUrl = args[1];
            LinkClient.Response a = LinkClient.request(d, "GET", "/v1/device/whoami", null, null, false, 15000);
            out.put("after401", a.status);
            out.put("after401Url", d.lastUrl.equals(good));
            // Something that answers 200 with an envelope this PC did not seal: next address.
            d.lastUrl = args[2];
            LinkClient.Response b = LinkClient.request(d, "GET", "/v1/device/whoami", null, null, false, 15000);
            out.put("afterForeign", b.status);
            // Sent but never answered: stop (no second send to another address).
            d.lastUrl = args[3];
            try {
                LinkClient.request(d, "POST", "/v1/echo?x=2", "{}", "application/json", false, 1500);
                out.put("silent", "answered");
            } catch (java.io.IOException noAnswer) {
                out.put("silent", noAnswer.getMessage());
            }
        }
        System.out.println(MiniJson.stringify(out));
    }
}
