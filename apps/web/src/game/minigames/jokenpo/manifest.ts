import { registerMiniGame } from "../registry";
import type { MiniGameManifest } from "../types";

export const JOKENPO_MANIFEST: MiniGameManifest = {
  id: "jokenpo",
  displayName: "JoKenPo",
};

registerMiniGame(JOKENPO_MANIFEST, () => import("./index"));
