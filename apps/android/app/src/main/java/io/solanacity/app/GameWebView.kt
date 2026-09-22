package io.solanacity.app

import android.content.Context
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.webkit.WebView

/**
 * A WebView that keeps the on-screen keyboard out of the game's way.
 *
 * In landscape, Android's IME defaults to "extract mode": it takes over the
 * whole screen with its own big text field, hiding the game completely behind
 * the keyboard while the player types in chat. These flags keep editing inline,
 * so the player still sees the city and the chat log above the keys.
 */
class GameWebView(
    context: Context,
) : WebView(context) {
    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
        val connection = super.onCreateInputConnection(outAttrs)
        outAttrs.imeOptions =
            outAttrs.imeOptions or
            EditorInfo.IME_FLAG_NO_EXTRACT_UI or
            EditorInfo.IME_FLAG_NO_FULLSCREEN
        return connection
    }
}
