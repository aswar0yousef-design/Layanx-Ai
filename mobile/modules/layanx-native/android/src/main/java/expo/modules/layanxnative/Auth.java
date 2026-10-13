package expo.modules.layanxnative;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

/**
 * The owner proves it is them before an approval leaves the phone: fingerprint, face or the screen-lock
 * PIN/pattern. Over the lock screen, unlocking the phone is that proof. A phone with no screen lock at
 * all cannot prove anything; the caller then asks for a plain confirmation instead ("unavailable").
 */
public final class Auth {
    private Auth() {}

    public interface Result { void done(String outcome); }

    public static final String OK = "ok", CANCELLED = "cancelled", UNAVAILABLE = "unavailable";

    private static int authenticators() {
        return Build.VERSION.SDK_INT >= 30
                ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
                : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    public static boolean available(Context c) {
        return BiometricManager.from(c).canAuthenticate(authenticators()) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    /** Must run on the main thread. */
    public static void confirm(FragmentActivity activity, String title, String subtitle, Result result) {
        KeyguardManager km = (KeyguardManager) activity.getSystemService(Context.KEYGUARD_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && km != null && km.isKeyguardLocked() && km.isDeviceSecure()) {
            km.requestDismissKeyguard(activity, new KeyguardManager.KeyguardDismissCallback() {
                @Override public void onDismissSucceeded() { result.done(OK); }
                @Override public void onDismissCancelled() { result.done(CANCELLED); }
                @Override public void onDismissError() { result.done(CANCELLED); }
            });
            return;
        }
        if (!available(activity)) { result.done(UNAVAILABLE); return; }
        BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), new BiometricPrompt.AuthenticationCallback() {
            private boolean finished;
            @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult r) { if (!finished) { finished = true; result.done(OK); } }
            @Override public void onAuthenticationError(int code, @NonNull CharSequence message) {
                if (finished) return;
                finished = true;
                result.done(code == BiometricPrompt.ERROR_HW_NOT_PRESENT || code == BiometricPrompt.ERROR_HW_UNAVAILABLE
                        || code == BiometricPrompt.ERROR_NO_BIOMETRICS || code == BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL ? UNAVAILABLE : CANCELLED);
            }
            // A finger that does not match just lets the prompt try again.
        });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle == null || subtitle.isEmpty() ? null : subtitle)
                .setAllowedAuthenticators(authenticators())
                .setConfirmationRequired(true)
                .build();
        prompt.authenticate(info);
    }

    /** Lets an activity that appears over the lock screen do so on every Android version. */
    @SuppressWarnings("deprecation")
    public static void showOverLockScreen(Activity a) {
        if (Build.VERSION.SDK_INT >= 27) { a.setShowWhenLocked(true); a.setTurnScreenOn(true); }
        else a.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
    }
}
