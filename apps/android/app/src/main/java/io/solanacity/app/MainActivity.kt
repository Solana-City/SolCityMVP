package io.solanacity.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import io.solanacity.app.ui.theme.SolCityTheme

/**
 * Hosts the Sol City web client in a WebView built on the Solana Mobile
 * web-shell template, adapted for a real-time game rather than a website:
 *
 *  - Immersive landscape, screen kept on, no pull-to-refresh and no WebView
 *    zoom. Both of those gestures fight the joystick and the game's own pinch
 *    zoom.
 *  - The hardware back button closes the open panel (Escape) instead of
 *    navigating the WebView history, which in a single-page game would exit.
 *  - JS timers pause after a while in the background, which stops the
 *    multiplayer poll draining battery, but never while a wallet hand-off is in
 *    flight, because the Mobile Wallet Adapter session runs on those timers
 *    while the wallet app is in front.
 */
class MainActivity : ComponentActivity() {
    private var webView: WebView? = null

    private var progress by mutableFloatStateOf(0f)
    private var isLoading by mutableStateOf(true)
    private var hasError by mutableStateOf(false)
    private var showSplash by mutableStateOf(true)

    private val mainHandler = Handler(Looper.getMainLooper())

    /** Set when a solana-wallet: link hands off to the wallet app, cleared on return. */
    private var walletHandoffPending = false
    private var timersPaused = false
    private val pauseTimersTask =
        Runnable {
            if (!walletHandoffPending) {
                webView?.pauseTimers()
                timersPaused = true
                Log.i(TAG, "JS timers paused after background grace period")
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        hideSystemBars()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val view = createWebView(this)
        webView = view

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() = routeBackToPage()
            },
        )

        setContent {
            SolCityTheme {
                GameLayer(
                    webView = view,
                    isLoading = isLoading,
                    progress = progress,
                    hasError = hasError,
                    showSplash = showSplash,
                    onRetry = {
                        hasError = false
                        isLoading = true
                        view.reload()
                    },
                )
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // System bars come back after dialogs, the keyboard and the wallet sheet.
        if (hasFocus) hideSystemBars()
    }

    override fun onPause() {
        super.onPause()
        webView?.onPause()
        if (!walletHandoffPending) {
            mainHandler.postDelayed(pauseTimersTask, BACKGROUND_GRACE_MS)
        }
    }

    override fun onResume() {
        super.onResume()
        mainHandler.removeCallbacks(pauseTimersTask)
        walletHandoffPending = false
        webView?.let { view ->
            if (timersPaused) {
                view.resumeTimers()
                timersPaused = false
            }
            view.onResume()
            // Lets the page resync the world after time away. Harmless if nothing listens.
            view.evaluateJavascript("window.dispatchEvent(new Event('solcity:native-resume'))", null)
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(pauseTimersTask)
        webView?.let { view ->
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
        }
        webView = null
        super.onDestroy()
    }

    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    /**
     * Asks the page to handle back. A page that defines
     * window.__solCityNativeBack() decides for itself and returns true when it
     * closed something; until it does, back sends Escape to window, where all of
     * the game's keydown listeners live, and counts as handled. Only an explicit
     * "unhandled" sends the app to the background, keeping the session alive
     * rather than finishing the Activity.
     */
    private fun routeBackToPage() {
        val view = webView ?: return
        view.evaluateJavascript(BACK_SCRIPT) { result ->
            if (result?.trim('"') == "unhandled") moveTaskToBack(true)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(context: Context): WebView {
        val startUrl = normalizeHttpUrl() ?: BuildConfig.WEB_SHELL_URL
        val scopeHosts = scopeHostsFor(startUrl)

        return WebView(context).apply {
            layoutParams =
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
            setBackgroundColor(0xFF061B3A.toInt())

            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.loadWithOverviewMode = false
            settings.useWideViewPort = false
            // Kept from the template until verified on device: the MWA session
            // talks to the wallet over ws://localhost from an https page.
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            // The game has its own pinch zoom (usePinchZoom); WebView zoom would
            // swallow those gestures and scale the whole page instead.
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            settings.setSupportZoom(false)
            // Ignore the system font scale so large-text settings cannot push UI
            // text out of its panels.
            settings.textZoom = 100
            // Music and SFX start from game events, not only from taps.
            settings.mediaPlaybackRequiresUserGesture = false
            settings.javaScriptCanOpenWindowsAutomatically = true
            settings.setSupportMultipleWindows(true)
            settings.offscreenPreRaster = true

            // "Solana Mobile Web Shell" is what @solana-mobile/wallet-standard-mobile
            // (>= 0.5.1) looks for to register MWA inside a WebView and skip the
            // browser's local-network permission flow. Without it the wallet
            // button disappears. SolCityApp/<version> lets our own analytics tell
            // the app apart from the browser.
            settings.userAgentString =
                appendUserAgentMarkers(settings.userAgentString, BuildConfig.VERSION_NAME)
            if (BuildConfig.DEBUG) Log.i(TAG, "UA: ${settings.userAgentString}")

            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            addJavascriptInterface(SolCityBridge(context), SolCityBridge.JS_NAME)

            webChromeClient =
                WebShellChromeClient(
                    onProgressChanged = { newProgress ->
                        // Qualified: inside apply, a bare `progress` is WebView.getProgress().
                        this@MainActivity.progress = newProgress / 100f
                        if (newProgress > 0) showSplash = false
                        isLoading = newProgress < 100
                    },
                    isDebug = BuildConfig.DEBUG,
                )

            webViewClient =
                object : WebShellViewClient(
                    context = context,
                    scopeHosts = scopeHosts,
                    onWalletHandoff = { walletHandoffPending = true },
                ) {
                    override fun onPageFinished(
                        view: WebView,
                        url: String?,
                    ) {
                        super.onPageFinished(view, url)
                        hasError = false
                    }

                    override fun onReceivedError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        error: WebResourceError?,
                    ) {
                        super.onReceivedError(view, request, error)
                        if (request?.isForMainFrame == true) hasError = true
                    }
                }

            loadUrl(startUrl)
        }
    }

    private companion object {
        const val TAG = "SolCity"

        /** Long enough to glance at a notification, short enough to matter for battery. */
        const val BACKGROUND_GRACE_MS = 30_000L

        val BACK_SCRIPT =
            """
            (function () {
              try {
                if (typeof window.__solCityNativeBack === 'function') {
                  return window.__solCityNativeBack() === true ? 'handled' : 'unhandled';
                }
                window.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
                }));
                return 'escape';
              } catch (e) {
                return 'unhandled';
              }
            })();
            """.trimIndent()
    }
}

@Composable
private fun GameLayer(
    webView: WebView,
    isLoading: Boolean,
    progress: Float,
    hasError: Boolean,
    showSplash: Boolean,
    onRetry: () -> Unit,
) {
    // Bars are hidden, so only the camera cutout needs keeping clear.
    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .windowInsetsPadding(WindowInsets.displayCutout),
    ) {
        AndroidView(modifier = Modifier.fillMaxSize(), factory = { webView })

        if (isLoading && !hasError) {
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter),
            )
        }

        if (hasError) {
            Box(
                modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = stringResource(R.string.load_error_title),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onBackground,
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Button(onClick = onRetry) {
                        Text(stringResource(R.string.load_error_retry))
                    }
                }
            }
        }

        AnimatedVisibility(visible = showSplash, exit = fadeOut()) {
            Box(
                modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        }
    }
}

private fun appendUserAgentMarkers(
    baseUserAgent: String,
    versionName: String,
): String {
    var ua = baseUserAgent.trim()
    for (marker in listOf("Solana Mobile Web Shell", "SolCityApp/$versionName")) {
        if (!ua.contains(marker)) ua = "$ua $marker"
    }
    return ua
}

/** The start host plus its www / apex twin; solanacity.io 307-redirects to www. */
private fun scopeHostsFor(startUrl: String): Set<String> {
    val host = startUrl.toUri().host.orEmpty().lowercase()
    val apex = host.removePrefix("www.")
    return setOf(host, apex, "www.$apex")
}

private fun normalizeHttpUrl(): String? {
    val trimmed = BuildConfig.WEB_SHELL_URL.trim()
    if (trimmed.isEmpty()) return null
    val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
    val uri = withScheme.toUri()
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") return null
    if (uri.host.isNullOrBlank()) return null
    return uri.toString()
}
