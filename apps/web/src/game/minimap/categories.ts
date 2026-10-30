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
  defi:      { label: "Protocols",   hint: "Swap, send, earn, privacy",     color: "#B7E928" },
  games:     { label: "Mini-games",  hint: "Play and win rewards",          color: "#FFA94D" },
  community: { label: "Community",   hint: "Projects, links and friends",   color: "#38bdf8" },
  landmark:  { label: "Places",      hint: "Buildings and landmarks",       color: "#c084fc" },
  players:   { label: "Players",     hint: "Other people online",           color: "#f8fafc" },
};

export const CATEGORY_ORDER: MinimapCategory[] = ["guide", "defi", "games", "community", "landmark", "players"];

/**
 * Per-NPC category overrides, keyed by NPCDefinition.id — for an NPC whose
 * category on the map legend should differ from what its action.type would
 * otherwise imply (e.g. a "link"-type NPC that reads as a mini-game, not a
 * community link). Set by the artist; not derived from anything else.
 */
const CATEGORY_OVERRIDES: Partial<Record<string, MinimapCategory>> = {
  "solsentry-crash": "defi",
  "cloak-vitin": "defi",
  "pegana-raffx": "defi",
  // Exa Energia's two hosts speak for one company, whose action is only a link
  // to its site, so they would read as Community; they are a Protocols stand.
  "exa-luiz": "defi",
  "exa-diogo": "defi",
  "dungeons-moles": "games",
  // A "placeholder" action until the Halloween mini-games are built, but he is
  // a games NPC on the legend from the day he lands, not a community link.
  "jack-o-lantern": "games",
};

export function npcCategory(npc: { id: string; action: NPCAction }): MinimapCategory {
  const override = CATEGORY_OVERRIDES[npc.id];
  if (override) return override;
  switch (npc.action.type) {
    case "tutor": return "guide";
    case "swap":
    case "transfer":
    case "bounties":
    case "private-payment":
    case "stock-exchange":
    case "ore-mine": return "defi";
    case "minigame": return "games";
    default: return "community";
  }
}

/**
 * Tiled layer (leaf) name -> the place name shown on the map. Layers not
 * listed (generic buildings, stands, decor) get no label.
 */
export const LANDMARK_LAYERS: Record<string, string> = {
  BuildSolanaCity: "SolanaCity",
  DecorFountain: "Central Fountain",
  BuildJupiter: "Jupiter",
  BuildMagicBlock: "MagicBlock",
  BuildMonkeDAo: "MonkeDAO",
  BuildSTEarn: "Superteam Earn",
  BuildSTBrLighthouse: "Superteam Brasil",
  BuildSTKZ: "ST Kazakhstan",
  BuildHome: "Home's Journey",
  BuildExaEnergia: "Exa Energia",
  BuildHiveBits: "HiveBits",
  BuildIndies: "Indies on Solana",
  BuildKGMachine: "Keep Green",
  BuildGreenHouse: "Greenhouse",
  BuildStandPegana: "Pegana",
  BuildStandSolSentry: "SolSentry",
  Pier: "Pier",
  BuildSolMechs: "Sol Mechs",
  BuildDungeousMoles: "Dungeous Moles",
  BuildStocklana: "Stocklana",
  BuildRemedi: "Remedi",
  BuildSeeker: "Seeker",
  BuildOre: "ORE",
  BuildSTVN: "Coffee Shop",
  BuildStandBP26: "Breakpoint 26",
  BuildColosseum: "Colosseum",
  BuildStandCloack: "Cloak",
  BuildMonkeDaoStand: "Banana Stand",
};
