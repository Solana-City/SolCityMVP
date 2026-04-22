export interface NPCAction {
  type: "tutor" | "swap" | "transfer" | "bounties";
  label: string;
}

export interface NPCDefinition {
  id: string;
  name: string;
  role: string;
  tileX: number;
  tileY: number;
  color: number;
  dialog: string[];
  action: NPCAction;
  /**
   * Optional path to a portrait PNG (served from /public).
   * Recommended: 256x256 px, transparent background, pixel art.
   * If missing or fails to load, the dialog falls back to a
   * colored tile with the NPC's initial.
   */
  portrait?: string;
}

export const NPC_REGISTRY: NPCDefinition[] = [
  {
    id: "sol-guide",
    name: "Sol",
    role: "City Guide",
    tileX: 16,
    tileY: 12,
    color: 0x14f195,
    dialog: [
      "Hey there! Welcome to The Solana City.",
      "I'm Sol, your guide. Let me show you around.",
      "First things first: your wallet is your identity here. It holds your tokens, your items, and your reputation.",
      "If you haven't connected one yet, tap the button in the top right corner. Phantom and Solflare both work great.",
      "Once connected, head over to the Swap NPC to exchange tokens, or visit the Send NPC to transfer SOL to a friend.",
      "Walk around and explore! You'll find the Superteam Hub with real bounties and job opportunities.",
      "Every action you take here is a real interaction. Your progress is yours to keep.",
    ],
    action: { type: "tutor", label: "Got it!" },
    portrait: "/assets/portraits/sol-guide.png",
  },
  {
    id: "swap-npc",
    name: "Jupiter Joe",
    role: "Token Swap",
    tileX: 12,
    tileY: 5,
    color: 0xffd700,
    dialog: [
      "Welcome to the Swap Station!",
      "I can help you exchange any Solana token for another.",
      "Powered by Jupiter, the swaps are fast, gasless, and MEV-protected.",
      "Just pick your tokens and the amount. I'll handle the rest.",
    ],
    action: { type: "swap", label: "Open swap" },
    portrait: "/assets/portraits/swap-npc.png",
  },
  {
    id: "send-npc",
    name: "Postmaster Ana",
    role: "Send Tokens",
    tileX: 20,
    tileY: 5,
    color: 0x00d1ff,
    dialog: [
      "Hello! I'm Ana, the Postmaster.",
      "Need to send SOL or any token to someone? You're in the right place.",
      "Just enter the destination address and the amount.",
      "The transfer goes through instantly on Solana.",
    ],
    action: { type: "transfer", label: "Send tokens" },
    portrait: "/assets/portraits/send-npc.png",
  },
  {
    id: "st-maya",
    name: "Maya",
    role: "Superteam Hub",
    tileX: 16,
    tileY: 19,
    color: 0x9945ff,
    dialog: [
      "Welcome to the Superteam Hub!",
      "We're the community arm of the Solana ecosystem.",
      "Here you can find bounties, from content creation to development tasks, all with real rewards.",
      "We also list job opportunities from top Solana projects.",
      "Complete bounties to earn score and unlock exclusive outfits!",
    ],
    action: { type: "bounties", label: "View bounties" },
    portrait: "/assets/portraits/st-maya.png",
  },
];
