export interface NPCAction {
  type: "tutor" | "swap" | "transfer" | "bounties" | "link" | "placeholder" | "private-payment";
  label: string;
  url?: string;
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
   * Phaser texture key for this NPC's sprite sheet. Loaded in BootScene.
   * Falls back to "avatar-chef" if not specified or not loaded.
   */
  spriteKey?: string;
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
    tileX: 99,
    tileY: 99,
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
    spriteKey: "avatar-sol-guide",
  },
  {
    id: "swap-npc",
    name: "Jupiter Joe",
    role: "Token Swap",
    tileX: 119,
    tileY: 92,
    color: 0x14f195,
    dialog: [
      "Welcome to the Swap Station!",
      "I can help you exchange any Solana token for another.",
      "Powered by Jupiter, the swaps are fast, gasless, and MEV-protected.",
      "Just pick your tokens and the amount. I'll handle the rest.",
    ],
    action: { type: "swap", label: "Open swap" },
    spriteKey: "avatar-brawly",
  },
  {
    id: "send-npc",
    name: "Postmaster Ana",
    role: "Send Tokens",
    tileX: 98,
    tileY: 104,
    color: 0x00d1ff,
    dialog: [
      "Hello! I'm Ana, the Postmaster.",
      "Need to send SOL or any token to someone? You're in the right place.",
      "Just enter the destination address and the amount.",
      "The transfer goes through instantly on Solana.",
    ],
    action: { type: "transfer", label: "Send tokens" },
    spriteKey: "avatar-send-npc",
  },
  {
    id: "st-maya",
    name: "Maya",
    role: "Superteam Hub",
    tileX: 113,
    tileY: 103,
    color: 0x9945ff,
    dialog: [
      "Welcome to the Superteam Hub!",
      "We're the community arm of the Solana ecosystem.",
      "Here you can find bounties, from content creation to development tasks, all with real rewards.",
      "We also list job opportunities from top Solana projects.",
      "Complete bounties to earn score and unlock exclusive outfits!",
    ],
    action: { type: "bounties", label: "View bounties" },
    spriteKey: "avatar-st-maya",
  },
  {
    id: "magic-man",
    name: "Magic Man",
    role: "Privacy Operator",
    tileX: 105,
    tileY: 85,
    color: 0xc026d3,
    dialog: [
      "In this city, every transaction is a public confession.",
      "Everyone can see who sent what, to whom, and when.",
      "But privacy is not a feature. It is a primitive.",
      "Through MagicBlock's Private Ephemeral Rollup, your transfers disappear. Shielded inside Intel TDX. No trace on-chain.",
      "Only you and the recipient will know what moved. Not the validators. Not the mempool. Not the curious.",
      "Let me handle the rest.",
    ],
    action: { type: "private-payment", label: "Send privately" },
    spriteKey: "avatar-juan",
  },
  // ── Placeholder NPCs (expansion district) ──────────────────────────
  // Parked here with light dialog until we assign them real roles.
  {
    id: "kuka",
    name: "Kuka",
    role: "Superteam Brazil Lead",
    tileX: 130,
    tileY: 92,
    color: 0xffd700,
    dialog: [
      "Hello, I'm Kuka. The Lead of Superteam Brazil.",
      "Past year Brazil won 2 prizes on the Cypherpunk Hackathon. We are making our part to get even more Brazilians on Solana.",
      "We are now hosting iRL and online sessions for Brazilian builders at The Garage, our Build Station with workshops and prep activities. Join us!",
    ],
    action: { type: "link", label: "Follow @superteamBR", url: "https://x.com/superteamBR" },
    spriteKey: "avatar-swap-npc",
  },
  {
    id: "bk-indies",
    name: "BK",
    role: "Indies on Solana",
    tileX: 79,
    tileY: 104,
    color: 0x7c3aed,
    dialog: [
      "Hello! I'm BK, the leader of Indies on Solana. A community initiative by the Indies for the Indies.",
      "Do you like games? There are lots of fun games being developed on Solana right now.",
      "On Indies on Solana, Season 2 will start soon. Registrations are open!",
    ],
    action: { type: "link", label: "Visit Indies on Solana", url: "https://indiesonsolana.com/" },
    spriteKey: "avatar-norman",
  },
  {
    id: "mr-bananas",
    name: "Mr. Bananas",
    role: "MonkeDAO",
    tileX: 67,
    tileY: 93,
    color: 0xffd700,
    dialog: [
      "Hey bro! Do you know MonkeDAO? I'm Bananas about it. That's why they call me MR. Bananas.",
      "We empower our members to leverage each other's expertise, driving collective success.",
      "If you're passionate about shaping the future of social organizations, we want you to be part of our journey!",
    ],
    action: { type: "link", label: "Visit MonkeDAO", url: "https://monkedao.io/" },
    spriteKey: "avatar-norman",
  },
  {
    id: "liza",
    name: "Michele",
    role: "Resident",
    tileX: 168,
    tileY: 155,
    color: 0xcccccc,
    dialog: [
      "Hi! I'm new here too.",
      "They tell me there will be cool stuff to do soon.",
      "For now, I'm just people-watching.",
    ],
    action: { type: "placeholder", label: "Take care" },
    spriteKey: "avatar-liza",
  },
  {
    id: "juan",
    name: "Dom",
    role: "Resident",
    tileX: 28,
    tileY: 48,
    color: 0xcccccc,
    dialog: [
      "Nice city, isn't it?",
      "I hear there's a Superteam Hub south of here. Worth checking out.",
    ],
    action: { type: "placeholder", label: "Catch you later" },
    spriteKey: "avatar-juan",
  },
];
