package expo.modules.layanxnative;

import android.app.AlertDialog;
import android.os.Bundle;
import androidx.fragment.app.FragmentActivity;

/**
 * "Approve" on an approval notification. Nothing is sent until the owner proves it is them (fingerprint,
 * face or the screen-lock PIN; on a locked phone, unlocking it). A phone with no screen lock gets a plain
 * confirmation instead. Then the decision goes to the PC, bound to the digest of what was shown.
 */
public final class ApproveActivity extends FragmentActivity {
    private boolean started;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Auth.showOverLockScreen(this);
        if (state != null && state.getBoolean("started")) { finish(); return; }
        String device = getIntent().getStringExtra("device"), id = getIntent().getStringExtra("id"), digest = getIntent().getStringExtra("digest");
        String title = getIntent().getStringExtra("title"), detail = getIntent().getStringExtra("detail");
        if (device == null || id == null || digest == null) { finish(); return; }
        started = true;
        Auth.confirm(this, title == null ? "موافقة LayanX" : title, shorten(detail), outcome -> {
            if (Auth.OK.equals(outcome)) send(device, id, digest);
            else if (Auth.UNAVAILABLE.equals(outcome)) askPlainly(device, id, digest, title, detail);
            else finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean("started", started);
    }

    private static String shorten(String s) {
        if (s == null) return null;
        String one = s.replace('\n', ' ').trim();
        return one.length() > 120 ? one.substring(0, 119) + "…" : one;
    }

    private void askPlainly(String device, String id, String digest, String title, String detail) {
        new AlertDialog.Builder(this)
                .setTitle(title == null ? "موافقة LayanX" : title)
                .setMessage((detail == null ? "" : detail + "\n\n") + "هذا الهاتف بلا قفل شاشة، لذلك لا يمكن التحقق ببصمة. هل توافق؟")
                .setPositiveButton("موافقة", (dlg, w) -> send(device, id, digest))
                .setNegativeButton("إلغاء", (dlg, w) -> finish())
                .setOnCancelListener(dlg -> finish())
                .show();
    }

    private void send(String device, String id, String digest) {
        new Thread(() -> {
            String error = Decisions.send(getApplicationContext(), device, id, digest, "approve");
            if (error == null) {
                Notify.cancelApproval(getApplicationContext(), id);
                Decisions.toast(this, "تمت الموافقة. يتابع LayanX العمل على الكمبيوتر.");
            } else {
                Decisions.toast(this, error);
            }
            runOnUiThread(this::finish);
        }, "layanx-approve").start();
    }
}
