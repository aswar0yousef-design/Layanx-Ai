package expo.modules.layanxnative;

import android.annotation.SuppressLint;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;
import java.io.ByteArrayOutputStream;

/**
 * Records a short voice question as 16 kHz mono WAV (what the PC's speech-to-text reads best), at most
 * 60 seconds. The clip goes to the PC inside the encrypted link and is not kept on the phone.
 */
public final class VoiceRecorder {
    private static final int RATE = 16000, MAX_SECONDS = 60;
    private static VoiceRecorder current;

    private final AudioRecord record;
    private final ByteArrayOutputStream pcm = new ByteArrayOutputStream();
    private final Thread reader;
    private volatile boolean running = true;

    @SuppressLint("MissingPermission") // the app asks for the microphone before calling start()
    private VoiceRecorder() {
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        record = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE));
        if (record.getState() != AudioRecord.STATE_INITIALIZED) { record.release(); throw new IllegalStateException("The microphone is not available"); }
        record.startRecording();
        reader = new Thread(() -> {
            byte[] buf = new byte[4096];
            long limit = (long) RATE * 2 * MAX_SECONDS;
            while (running && pcm.size() < limit) {
                int n = record.read(buf, 0, buf.length);
                if (n > 0) pcm.write(buf, 0, n); else if (n < 0) break;
            }
        }, "layanx-voice");
        reader.start();
    }

    public static synchronized void start() {
        if (current != null) current.finish();
        current = new VoiceRecorder();
    }

    /** Stops and returns {base64 WAV, milliseconds}; null when nothing was recording. */
    public static synchronized Object[] stop() {
        if (current == null) return null;
        VoiceRecorder r = current;
        current = null;
        byte[] data = r.finish();
        byte[] wav = wav(data);
        return new Object[] { Base64.encodeToString(wav, Base64.NO_WRAP), (long) data.length * 1000L / (RATE * 2) };
    }

    public static synchronized void cancel() {
        if (current != null) { current.finish(); current = null; }
    }

    public static synchronized boolean recording() { return current != null; }

    private byte[] finish() {
        running = false;
        try { record.stop(); } catch (Exception ignored) { }
        try { reader.join(1000); } catch (InterruptedException ignored) { }
        record.release();
        return pcm.toByteArray();
    }

    private static byte[] wav(byte[] pcm) {
        int byteRate = RATE * 2;
        ByteArrayOutputStream out = new ByteArrayOutputStream(44 + pcm.length);
        writeAscii(out, "RIFF"); le32(out, 36 + pcm.length); writeAscii(out, "WAVE");
        writeAscii(out, "fmt "); le32(out, 16); le16(out, 1); le16(out, 1); le32(out, RATE); le32(out, byteRate); le16(out, 2); le16(out, 16);
        writeAscii(out, "data"); le32(out, pcm.length);
        out.write(pcm, 0, pcm.length);
        return out.toByteArray();
    }

    private static void writeAscii(ByteArrayOutputStream o, String s) { for (int i = 0; i < s.length(); i++) o.write(s.charAt(i)); }
    private static void le32(ByteArrayOutputStream o, int v) { o.write(v & 0xff); o.write((v >> 8) & 0xff); o.write((v >> 16) & 0xff); o.write((v >> 24) & 0xff); }
    private static void le16(ByteArrayOutputStream o, int v) { o.write(v & 0xff); o.write((v >> 8) & 0xff); }
}
