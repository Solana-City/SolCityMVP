import { registerMiniGame } from "../registry";
import type { MiniGameManifest } from "../types";

export const FOOD_CART_MANIFEST: MiniGameManifest = {
  id: "food-cart",
  displayName: "Food Cart",
};

registerMiniGame(
  FOOD_CART_MANIFEST,
  () => import("./index")
);
