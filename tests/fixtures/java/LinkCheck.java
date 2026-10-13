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
        System.out.println(MiniJson.stringify(out));
    }
}
