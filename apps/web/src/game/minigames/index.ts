// Side-effect imports — each manifest calls registerMiniGame at module load time.
// Import this module (or anything that imports it) before calling launch().
import "./food-cart/manifest";
import "./jokenpo/manifest";

export { launch, getEntry, registerMiniGame } from "./registry";
export type {
  MiniGameContext,
  MiniGameResult,
  MiniGameManifest,
  MiniGameComponentProps,
  FoodCartContext,
  JokenpoContext,
  JokenpoOpponent,
} from "./types";
