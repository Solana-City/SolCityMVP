package io.solanacity.app

import android.util.Log
import android.webkit.WebView
import org.json.JSONObject

// Unchanged from the Solana Mobile web-shell template. Some WebView builds
// report 100vh / 100dvh as ~0px; this measures after each page load and, only
// when broken, pins those units to window.innerHeight.

internal fun probeViewportAndMaybePatch(
    webView: WebView,
    isDebug: Boolean,
) {
    webView.evaluateJavascript(VIEWPORT_PROBE_AND_PATCH_SCRIPT) { rawResult ->
        val decoded = decodeJavascriptStringResult(rawResult)
        val parsed = runCatching { JSONObject(decoded) }.getOrNull()
        val isBroken = parsed?.optBoolean("broken") == true
        if (isDebug || isBroken) {
            Log.i(VP_TAG, "[VP] ${parsed?.toString() ?: decoded}")
        }
    }
}

private fun decodeJavascriptStringResult(rawResult: String?): String {
    if (rawResult.isNullOrBlank() || rawResult == "null") return ""
    return runCatching { JSONObject("{\"value\":$rawResult}").getString("value") }
        .getOrDefault(rawResult)
}

private const val VP_TAG = "SolCity"

private val VIEWPORT_PROBE_AND_PATCH_SCRIPT =
    """
    (function () {
      function measureViewport() {
        var probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;';
        document.documentElement.appendChild(probe);
        probe.style.height = '100vh';
        var vh = probe.getBoundingClientRect().height;
        probe.style.height = '100dvh';
        var dvh = probe.getBoundingClientRect().height;
        document.documentElement.removeChild(probe);
        return {
          innerHeight: window.innerHeight || 0,
          visualViewportHeight: window.visualViewport ? window.visualViewport.height : 0,
          vh: vh,
          dvh: dvh
        };
      }

      function updateViewportVars() {
        var px = Math.max(window.innerHeight || 0, 1) + 'px';
        document.documentElement.style.setProperty('--webshell-vh-px', px);
        document.documentElement.style.setProperty('--webshell-dvh-px', px);
      }

      function applyFallbackPatch() {
        updateViewportVars();
        if (!window.__webshell_viewport_resize_hook__) {
          window.__webshell_viewport_resize_hook__ = true;
          window.addEventListener('resize', updateViewportVars);
          window.addEventListener('orientationchange', updateViewportVars);
          if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', updateViewportVars);
          }
        }

        var style = document.getElementById('__webshell_viewport_patch_style__');
        if (!style) {
          style = document.createElement('style');
          style.id = '__webshell_viewport_patch_style__';
          style.textContent = [
            ':root { --webshell-vh-px: 100vh; --webshell-dvh-px: 100vh; }',
            'html, body, #root, #app { min-height: var(--webshell-dvh-px) !important; height: auto !important; }',
            '[class~="h-screen"], [class~="h-dvh"], [class*="h-screen"], [class*="h-dvh"] { height: var(--webshell-dvh-px) !important; }',
            '[class~="min-h-screen"], [class~="min-h-dvh"], [class*="min-h-screen"], [class*="min-h-dvh"] { min-height: var(--webshell-dvh-px) !important; }',
            '[class~="max-h-screen"], [class~="max-h-dvh"], [class*="max-h-screen"], [class*="max-h-dvh"] { max-height: var(--webshell-dvh-px) !important; }'
          ].join('\\n');
          document.documentElement.appendChild(style);
        }

        var classElements = document.querySelectorAll('[class]');
        for (var i = 0; i < classElements.length; i++) {
          var className = classElements[i].className;
          if (typeof className !== 'string') continue;
          if (className.indexOf('max-h-[calc(100dvh-1rem)]') !== -1 || className.indexOf('max-h-[calc(100vh-1rem)]') !== -1) {
            classElements[i].style.maxHeight = 'calc(var(--webshell-dvh-px) - 1rem)';
          }
        }
      }

      var before = measureViewport();
      var broken = before.innerHeight > 0 && (before.vh <= 1 || before.dvh <= 1);
      if (broken) {
        applyFallbackPatch();
      }
      var after = measureViewport();
      return JSON.stringify({
        broken: broken,
        patched: broken,
        before: before,
        after: after
      });
    })();
    """.trimIndent()
