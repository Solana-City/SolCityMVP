/**
 * Minimap point categories, shared by the scene (which classifies) and the
 * React map (which draws the markers and the legend).
 */
import type { NPCAction } from "../config/npcRegistry";

export type MinimapCategory = "guide" | "defi" | "games" | "community" | "landmark" | "players";

export interface CategoryMeta {
  label: string;
  /** What the legend says this category is for. */
  hint: string;
  color: string;
}

export const CATEGORY_META: Record<MinimapCategory, CategoryMeta> = {
  guide:     { label: "Guide",       hint: "Start here",                    color: "#facc15" },
  defi:      { label: "Protocols",   hint: "Swap, send, earn, privacy",     color: "#14F195" },
  games:     { label: "Mini-games",  hint: "Play and win rewards",          color: "#FFA94D" },
  community: { label: "Community",   hint: "Projects, links and friends",   color: "#38bdf8" },
  landmark:  { label: "Places",      hint: "Buildings and landmarks",       color: "#c084fc" },
  players:   { label: "Players",     hint: "Other people online",           color: "#f8fafc" },
};

export const CATEGORY_ORDER: MinimapCategory[] = ["guide", "defi", "games", "community", "landmark", "players"];

export function npcCategory(action: NPCAction): MinimapCategory {
  switch (action.type) {
    case "tutor": return "guide";
    case "swap":
    case "transfer":
    case "bounties":
    case "private-payment":
    case "stock-exchange": return "defi";
    case "minigame": return "games";
    default: return "community";
  }
}

/**
 * Tiled layer (leaf) name -> the place name shown on the map. Layers not
 * listed (generic buildings, stands, decor) get no label.
 */
export const LANDMARK_LAYERS: Record<string, string> = {
  BuildSolanaCity: "Solana City",
  DecorFountain: "Central Fountain",
  BuildJupiter: "Jupiter",
  BuildMagicBlock: "MagicBlock",
  BuildMonkeDAo: "MonkeDAO",
  BuildSTEarn: "Superteam Earn",
  BuildSTBrLighthouse: "ST Brasil Lighthouse",
  BuildIndies: "Indies on Solana",
  BuildKGMachine: "Keep Green",
  BuildGreenHouse: "Greenhouse",
  BuildStandPegana: "Pegana",
  BuildStandSolSentry: "SolSentry",
  Pier: "Pier",
  BuildSolMechs: "Sol Mechs",
  BuildDungeousMoles: "Dungeous Moles",
};
