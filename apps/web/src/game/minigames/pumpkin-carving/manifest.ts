import { registerMiniGame } from "../registry";
import type { MiniGameManifest } from "../types";

export const PUMPKIN_CARVING_MANIFEST: MiniGameManifest = {
  id: "pumpkin-carving",
  displayName: "Pumpkin Carving",
};

registerMiniGame(PUMPKIN_CARVING_MANIFEST, () => import("./index"));
