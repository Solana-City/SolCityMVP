/** detail: { wallet, name? } — opens the chat on a conversation with that player. */
export const OPEN_DM_EVENT = "solcity:open-dm";

export const DMS_OFF_KEY = "solcity:dms-off";
/** Fired when the player flips the "receive DMs" setting. */
export const DM_SETTINGS_EVENT = "solcity:dm-settings";

export function dmsOffPref(): boolean {
  try { return localStorage.getItem(DMS_OFF_KEY) === "1"; } catch { return false; }
}

/** Set when the player changes the setting here and the server hasn't heard yet. */
export const DMS_PENDING_KEY = "solcity:dms-off-pending";

export function setDmsOffPref(off: boolean): void {
  try {
    localStorage.setItem(DMS_OFF_KEY, off ? "1" : "0");
    localStorage.setItem(DMS_PENDING_KEY, "1");
  } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent(DM_SETTINGS_EVENT, { detail: { off } }));
}
