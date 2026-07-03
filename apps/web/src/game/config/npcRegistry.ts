export interface NPCAction {
  type: "tutor" | "swap" | "transfer" | "bounties" | "link" | "placeholder" | "private-payment" | "minigame";
  label: string;
  url?: string;
  miniGameId?: string;
  orderType?: "burger" | "sushi";
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
   * Phaser texture key for this NPC's sprite.
   * Falls back to "avatar-player" if not specified or not loaded.
   * Points to a spritesheet (same format as the player: 64×64 frames).
   */
  spriteKey?: string;
  /**
   * Set to false to hide this NPC from the city without removing its
   * definition (e.g. temporarily disabled while content is reworked).
   * Defaults to true.
   */
  enabled?: boolean;
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
    spriteKey: "Sol",
  },
  {
    id: "sushi-man",
    name: "Sushi Man",
    role: "Food Cart",
    tileX: 145,
    tileY: 104,
    color: 0xff6b35,
    dialog: [
      "Irasshaimase! Welcome to my cart.",
      "Orders are piling up — burger or sushi, it doesn't matter.",
      "I just need someone who can assemble them in the right order, fast.",
      "Think you've got the hands for it?",
    ],
    action: { type: "minigame", label: "Start cooking!", miniGameId: "food-cart", orderType: "sushi" },
    spriteKey: "Sushi Man",
  },
  {
    id: "kite-pro",
    name: "Kite Pro",
    role: "Kite Clash",
    tileX: 150,
    tileY: 120,
    color: 0x00b4d8,
    dialog: [
      "Hey! Want to take a kite up and see who else is flying right now?",
      "Stay airborne to rack up points — the further out you let your line, the faster you score.",
      "But flying high makes you an easy target. Cut a rival's line for a bonus, if you dare.",
    ],
    action: { type: "minigame", label: "Launch Kite", miniGameId: "kite-clash" },
    spriteKey: "Kite Pro",
  },
  {
    id: "swap-npc",
    name: "Jupiter Cat",
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
    spriteKey: "Jupiter Joe",
  },
  {
    id: "send-npc",
    name: "Steve Sends",
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
    id: "pratik",
    name: "Pratik",
    role: "Superteam Earn",
    tileX: 116,
    tileY: 101,
    color: 0x9945ff,
    dialog: [
      "Hey! I run the Superteam Earn hub, where builders get paid to work on Solana.",
      "Tasks range from quick $50 bounties to $5,000+ projects, for designers, developers, and writers.",
      "Pick what fits your time and skills. Rewards are paid in USDC.",
    ],
    action: { type: "bounties", label: "Explore Earn" },
    spriteKey: "Pratik",
  },
  {
    id: "magic-man",
    name: "Magic Man",
    role: "Privacy Operator",
    tileX: 113,
    tileY: 117,
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
    spriteKey: "Magic Man",
  },
  // ── Expansion district NPCs ──────────────────────────────────────
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
    spriteKey: "Kuka",
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
    spriteKey: "BK",
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
    spriteKey: "Mr. Bananas",
  },
  {
    id: "liza",
    name: "Michele",
    role: "DRiP Collector",
    enabled: false,
    tileX: 168,
    tileY: 155,
    color: 0x00d1ff,
    dialog: [
      "I collect NFTs the way some people collect trading cards — but these ones are free.",
      "DRiP drops original art from independent creators straight into your Solana wallet. No minting fees, no gas wars.",
      "Every week I get something new. Some pieces are 1-of-1 gems, others are open editions. All on-chain.",
      "Subscribe to a creator you like and the drop just arrives. It's the most relaxed way to own art on Solana.",
    ],
    action: { type: "link", label: "Open DRiP", url: "https://drip.haus/" },
    spriteKey: "avatar-liza",
  },
  {
    id: "juan",
    name: "Dom",
    role: "Solana Mobile",
    enabled: false,
    tileX: 28,
    tileY: 48,
    color: 0x9945ff,
    dialog: [
      "Out here on the frontier — best place to test the Seeker.",
      "Solana Mobile built a phone for people who actually use crypto. Hardware seed vault, one-tap signing, no extension drama.",
      "The dApp Store is growing fast. Games, DeFi, wallets — all optimised for mobile-first.",
      "If you're building on Solana, submitting your PWA to the dApp Store is low-hanging fruit. I'd do it.",
    ],
    action: { type: "link", label: "Solana Mobile", url: "https://solanamobile.com/" },
    spriteKey: "avatar-juan",
  },
];
