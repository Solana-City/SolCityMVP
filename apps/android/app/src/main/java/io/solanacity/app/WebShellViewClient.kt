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
                // Any other scheme (mailto:, tel:, an app's own) reaches only
                // the handlers a browser could reach, as with intent: below.
                launch(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
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

    /**
     * An intent: link is built by the page, so it gets what Chrome allows it
     * and no more (audit R-24): no explicit component or selector, which could
     * otherwise reach a non-exported-to-browsers activity in any app, no URI
     * permission grants, and only activities that declare BROWSABLE. The site
     * itself sends none; this is for whatever else ends up in the WebView.
     */
    private fun handleIntentScheme(url: String) {
        try {
            val intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
                component = null
                selector = null
                flags = flags and URI_GRANT_FLAGS.inv()
            }
            if (intent.resolveActivity(context.packageManager) != null) {
                context.startActivity(intent)
            } else {
                // Only a web page as the fallback, never another intent: link.
                val fallback = intent.getStringExtra("browser_fallback_url")?.toUri()
                if (fallback?.scheme == "https" || fallback?.scheme == "http") {
                    context.startActivity(Intent(Intent.ACTION_VIEW, fallback))
                }
            }
        } catch (_: Exception) {
            // Malformed link or no handler available, silently ignore.
        }
    }

    private companion object {
        const val URI_GRANT_FLAGS =
            Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
    }
}
