import { registerMiniGame } from "../registry";
import type { MiniGameManifest } from "../types";

export const SOL_MECHS_MANIFEST: MiniGameManifest = {
  id: "sol-mechs",
  displayName: "Sol Mechs",
};

registerMiniGame(SOL_MECHS_MANIFEST, () => import("./index"));
