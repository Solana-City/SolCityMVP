import { registerMiniGame } from "../registry";
import type { MiniGameManifest } from "../types";

export const HAIR_SPECIALIST_MANIFEST: MiniGameManifest = {
  id: "hair-specialist",
  displayName: "Hair Specialist",
};

registerMiniGame(HAIR_SPECIALIST_MANIFEST, () => import("./index"));
