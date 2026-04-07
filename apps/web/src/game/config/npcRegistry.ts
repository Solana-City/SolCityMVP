export interface NPCAction {
  type: "swap" | "transfer" | "bounties" | "explore" | "port";
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
}

export const NPC_REGISTRY: NPCDefinition[] = [
  {
    id: "jupiter-joe",
    name: "Jupiter Joe",
    role: "Trading",
    tileX: 12,
    tileY: 5,
    color: 0xffd700,
    dialog: [
      "Welcome to Jupiter Trading!",
      "Here you can swap any token for another.",
      "Fast, gasless, and MEV-protected.",
    ],
    action: { type: "swap", label: "Open swap" },
  },
  {
    id: "postmaster-ana",
    name: "Postmaster Ana",
    role: "Transfers",
    tileX: 20,
    tileY: 5,
    color: 0x00d1ff,
    dialog: [
      "Hello! I handle all transfers.",
      "Send tokens to any Solana address.",
      "Just tell me the destination and amount!",
    ],
    action: { type: "transfer", label: "Send tokens" },
  },
  {
    id: "guild-rex",
    name: "Guild Master Rex",
    role: "Discovery",
    tileX: 6,
    tileY: 19,
    color: 0xff6b35,
    dialog: [
      "The Explorer Guild connects you to services!",
      "Marinade, Tensor, Orca, Raydium...",
      "Complete expeditions to earn the Explorer Badge!",
    ],
    action: { type: "explore", label: "Browse services" },
  },
  {
    id: "st-maya",
    name: "ST Lead Maya",
    role: "Superteam",
    tileX: 22,
    tileY: 19,
    color: 0x9945ff,
    dialog: [
      "Welcome to the Superteam Hub!",
      "We have bounties, jobs, and meetups.",
      "Contributors earn exclusive outfits!",
    ],
    action: { type: "bounties", label: "View bounties" },
  },
  {
    id: "captain-block",
    name: "Captain Block",
    role: "Block Port",
    tileX: 28,
    tileY: 8,
    color: 0x4a9eff,
    dialog: [
      "Welcome to the Block Port!",
      "Each ship that departs carries a block of transactions.",
      "If the ships keep sailing, the network is healthy.",
    ],
    action: { type: "port", label: "View block port" },
  },
];
