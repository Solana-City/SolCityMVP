package io.solanacity.app

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.net.toUri

/**
 * Navigation policy, from the Solana Mobile web-shell template.
 *
 * The solana-wallet: branch is what makes the Mobile Wallet Adapter work inside
 * a WebView: the MWA library navigates to solana-wallet:/v1/associate/... and a
 * WebView will not launch that on its own, so it is forwarded to the wallet app
 * as a VIEW intent. Changes from the template: several in-scope hosts (www and
 * apex), a callback so the Activity knows a wallet hand-off is in flight, and a
 * guard for devices without a wallet installed.
 */
open class WebShellViewClient(
    private val context: Context,
    private val scopeHosts: Set<String>,
    private val onWalletHandoff: () -> Unit,
) : WebViewClient() {
    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        val url = request.url
        val scheme = url.scheme ?: return false

        // Never intercept subframe (iframe) navigation; embedded SDKs rely on it.
        if (!request.isForMainFrame) return false

        return when (scheme) {
            "solana-wallet" -> {
                onWalletHandoff()
                launch(Intent(Intent.ACTION_VIEW, url))
                // The wallet protocol library uses window.blur to detect that the
                // wallet app opened. In a WebView the blur event never fires, so a
                // synthetic one unblocks the detection promise (3s timeout).
                view.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null)
                true
            }

            "intent" -> {
                handleIntentScheme(url.toString())
                true
            }

            "blob", "javascript" -> false

            "http", "https" -> {
                if (url.host?.lowercase() in scopeHosts) {
                    false
                } else {
                    // External links (partner protocols, docs) open in the browser
                    // so the game keeps its WebView and its session.
                    launch(Intent(Intent.ACTION_VIEW, url))
                    true
                }
            }

            else -> {
                launch(Intent(Intent.ACTION_VIEW, url))
                true
            }
        }
    }

    override fun onPageFinished(
        view: WebView,
        url: String?,
    ) {
        super.onPageFinished(view, url)
        probeViewportAndMaybePatch(view, BuildConfig.DEBUG)
    }

    private fun launch(intent: Intent) {
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            // No handler, e.g. no wallet app installed. The MWA library surfaces
            // its own "wallet not found" message after its timeout.
        }
    }

    private fun handleIntentScheme(url: String) {
        try {
            val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
            if (intent.resolveActivity(context.packageManager) != null) {
                context.startActivity(intent)
            } else {
                val fallback = intent.getStringExtra("browser_fallback_url")
                if (fallback != null) {
                    context.startActivity(Intent(Intent.ACTION_VIEW, fallback.toUri()))
                }
            }
        } catch (_: Exception) {
            // No handler available, silently ignore.
        }
    }
}
