import { registerMiniGame } from "../registry";
import type { MiniGameManifest } from "../types";

export const KITE_CLASH_MANIFEST: MiniGameManifest = {
  id: "kite-clash",
  displayName: "Kite Clash",
};

registerMiniGame(KITE_CLASH_MANIFEST, () => import("./index"));
