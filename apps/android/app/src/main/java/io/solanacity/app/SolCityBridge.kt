package io.solanacity.app

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface

/**
 * Native capabilities exposed to the page as window.SolCityNative.
 *
 * The web client must treat this object as optional: in a browser it does not
 * exist, and every caller falls back to doing nothing. That is what keeps one
 * web build serving desktop, mobile browsers and this app.
 *
 * addJavascriptInterface injects into every frame, including third-party
 * iframes. The methods here are deliberately harmless (a version string, a
 * vibration). Anything sensitive, such as secure key storage or a push token,
 * must go through WebViewCompat.addWebMessageListener with an origin allowlist
 * instead of being added to this class.
 *
 * JavascriptInterface methods run on a WebView background thread, not the UI
 * thread. Release builds keep them through the rule in proguard-rules.pro.
 */
class SolCityBridge(
    context: Context,
) {
    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        }

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    /**
     * Plays a named haptic pattern. Unknown names are ignored, so the web side
     * can add names before the app knows them.
     *
     *   tap      light tick, UI confirmation
     *   select   click, NPC interaction or menu choice
     *   heavy    strong click, a hit landing
     *   success  two rising pulses, a win or a confirmed transaction
     *   warning  three short pulses, a loss or an error
     */
    @JavascriptInterface
    fun haptic(kind: String) {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        val effect = effectFor(kind) ?: return
        v.vibrate(effect)
    }

    private fun effectFor(kind: String): VibrationEffect? =
        when (kind) {
            "tap" -> predefinedOr(VibrationEffect.EFFECT_TICK, 10)
            "select" -> predefinedOr(VibrationEffect.EFFECT_CLICK, 20)
            "heavy" -> predefinedOr(VibrationEffect.EFFECT_HEAVY_CLICK, 40)
            "success" -> waveform(longArrayOf(0, 30, 60, 50), intArrayOf(0, 120, 0, 255))
            "warning" -> waveform(longArrayOf(0, 40, 50, 40, 50, 40), intArrayOf(0, 200, 0, 200, 0, 200))
            else -> null
        }

    private fun predefinedOr(
        effectId: Int,
        fallbackMs: Long,
    ): VibrationEffect =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            VibrationEffect.createPredefined(effectId)
        } else {
            VibrationEffect.createOneShot(fallbackMs, VibrationEffect.DEFAULT_AMPLITUDE)
        }

    private fun waveform(
        timings: LongArray,
        amplitudes: IntArray,
    ): VibrationEffect =
        if (vibrator?.hasAmplitudeControl() == true) {
            VibrationEffect.createWaveform(timings, amplitudes, -1)
        } else {
            VibrationEffect.createWaveform(timings, -1)
        }

    companion object {
        const val JS_NAME = "SolCityNative"
    }
}
