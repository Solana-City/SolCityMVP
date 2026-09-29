"use client";

/**
 * When a disconnected wallet actually means the player left.
 *
 * `useWallet().connected` goes false for reasons that have nothing to do with
 * the player: the extension reloading itself, a phone backgrounding the tab,
 * an auto-connect race when the window regains focus. The city already knows
 * this — CityScene waits 1.2s before tearing a session down — but the connect
 * screen used to believe it instantly and slam the login screen over the
 * game. Players saw the city blink away and come back, or blink away and stay
 * away until they pressed connect again.
 *
 * So the UI waits too, and a bit longer than the game does, since it is the
 * thing the player is looking at. A logout through the button skips the wait
 * entirely: that one is a decision, not a glitch.
 */

/** Dispatched on `window` right before an intentional `disconnect()`. */
export const WALLET_LOGOUT_EVENT = "solcity:wallet-logout";

/**
 * How long a wallet may report itself disconnected before the city believes
 * it. Comfortably past CityScene's own 1.2s debounce, so the session is never
 * torn down while the screen still shows the city.
 */
export const WALLET_FLAP_GRACE_MS = 4_000;
