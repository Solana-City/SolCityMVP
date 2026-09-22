package io.solanacity.app

import android.content.Intent
import android.os.Message
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

class WebShellChromeClient(
    private val onProgressChanged: (Int) -> Unit,
    private val isDebug: Boolean,
) : WebChromeClient() {
    override fun onProgressChanged(
        view: WebView,
        newProgress: Int,
    ) {
        onProgressChanged.invoke(newProgress)
    }

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        if (!isDebug && consoleMessage.messageLevel() != ConsoleMessage.MessageLevel.ERROR) {
            return true
        }
        val level =
            when (consoleMessage.messageLevel()) {
                ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                ConsoleMessage.MessageLevel.DEBUG -> Log.DEBUG
                else -> Log.INFO
            }
        Log.println(
            level,
            TAG,
            "${consoleMessage.message()} @ ${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}",
        )
        return true
    }

    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        // Handle window.open() and target="_blank" links (used by OAuth
        // flows like Privy, social logins, etc.).  Open the URL in the
        // system browser so the user can complete the flow there.
        val newWebView = WebView(view.context)
        newWebView.webViewClient =
            object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    view.context.startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    return true
                }
            }
        val transport = resultMsg.obj as WebView.WebViewTransport
        transport.webView = newWebView
        resultMsg.sendToTarget()
        return true
    }

    private companion object {
        const val TAG = "SolCity"
    }
}
