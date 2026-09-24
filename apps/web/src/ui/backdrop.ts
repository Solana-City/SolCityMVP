/**
 * Closing a panel by tapping outside it.
 *
 * A plain `onClick` on the backdrop also fires when the press STARTED
 * somewhere else, which is how a panel opened from the mobile ACT button shut
 * itself the moment the finger came up. These props close only on a tap that
 * began on the backdrop itself.
 */
import type React from "react";

export function backdropClose(onClose: () => void) {
  let armed = false;
  return {
    onPointerDown: (e: React.PointerEvent) => { armed = e.target === e.currentTarget; },
    onClick: (e: React.MouseEvent) => {
      if (armed && e.target === e.currentTarget) onClose();
      armed = false;
    },
  };
}
