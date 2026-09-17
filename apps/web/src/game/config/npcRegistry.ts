export interface NPCAction {
  type: "tutor" | "swap" | "transfer" | "bounties" | "link" | "placeholder" | "private-payment" | "minigame" | "stock-exchange";
  label: string;
  url?: string;
  miniGameId?: string;
  orderType?: "sushi";
}

/** A picture + a word or two, shown on an NPC's last dialog line. */
export interface NPCHighlight {
  /** Image under /public, e.g. "/assets/minigames/kite/kites/kite_stb.png". */
  img?: string;
  /** Or a 256x256 character sheet in /assets/sprites (frame 0 is used). */
  sheet?: string;
  label: string;
}

export interface NPCDefinition {
  id: string;
  /**
   * Up to three picture cards shown with the last dialog line, so what the
   * NPC is about reads at a glance instead of in a paragraph.
   */
  highlights?: NPCHighlight[];
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
   * Optional second sheet, swapped in while this NPC is walking and swapped
   * back on arrival. Same 64×64 walk-grid contract as `spriteKey`.
   *
   * Only needed for art drawn as two sheets — Caramel Dog ships a sitting idle
   * and a separate trot cycle. NPCs whose single sheet already carries a
   * standing frame in column 0 leave this unset.
   */
  spriteWalkKey?: string;
  /**
   * How far this NPC may stray from its spawn tile while wandering, in world
   * pixels. Defaults to 18 (under one tile) — enough to look alive in place.
   *
   * Raise it for an NPC that should actually roam. The wander is clamped to a
   * box of this radius around the spawn, so the value doubles as the leash
   * that keeps it inside its own district.
   */
  wanderRadius?: number;
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
  /**
   * Set this for a "static animated" NPC: one that never wanders and
   * always faces the same direction (typically south), but plays a
   * looping animation in place (e.g. a kite flyer whose arms/kite move).
   *
   * The sprite sheet contract is different from the default 4-row walk
   * grid: a single row of `frameCount` frames, all facing the same way.
   * `spriteKey`'s file must match this layout when this is set.
   */
  spriteAnimation?: {
    frameWidth: number;
    frameHeight: number;
    frameCount: number;
    /**
     * Render scale override. The default 64x64 walk-grid NPCs auto-scale
     * to 0.5 (world px = half the source sheet), but a static-animated
     * sheet often includes a prop above the character's head (e.g. a kite)
     * that inflates the frame well past the character's own height — using
     * the same auto-scale then renders it far bigger than other NPCs.
     * Set this to whatever makes the character (not the prop) match the
     * usual NPC size.
     */
    scale?: number;
    /**
     * Horizontal shift (source px) of the ground contact blob, for sheets
     * whose character isn't centered in its frame — e.g. Kite Pro sits
     * right of center to counterbalance the kite string, so its blob needs
     * nudging right to sit under the feet. The mirrored silhouette already
     * lines up (it's the whole frame) and is unaffected.
     */
    blobOffsetX?: number;
  };
}

export const NPC_REGISTRY: NPCDefinition[] = [
  {
    id: "sol-guide",
    name: "Sol",
    role: "City Guide",
    // Central fountain plaza, three tiles down the path from the spawn steps
    // (where Steve Sends used to stand).
    tileX: 78,
    tileY: 43,
    color: 0x14f195,
    dialog: [
      "Hi, I'm Sol, your city guide!",
      "Want a quick tour of how everything works?",
    ],
    action: { type: "tutor", label: "Start the tour" },
    spriteKey: "Sol",
  },
  {
    id: "sushi-man",
    name: "Sushi Man",
    role: "Food Cart",
    // In front of the food cart (GameAssetFoodCar, cols 109-112 / rows 40-43),
    // on the green plot east of the Superteam Earn tent.
    tileX: 110,
    tileY: 43,
    color: 0xff6b35,
    dialog: [
      "Irasshaimase! Welcome to my cart.",
      "Customers are hungry. Build their sushi sets in order, before time runs out!",
    ],
    action: { type: "minigame", label: "Start cooking!", miniGameId: "food-cart", orderType: "sushi" },
    spriteKey: "Sushi Man",
  },
  {
    id: "kite-pro",
    name: "Kite Pro",
    role: "Kite Clash",
    // Superteam Brazil zone — out on the open sand, south of the market
    // stands, where there is vertical room for the kite.
    tileX: 40,
    tileY: 79,
    color: 0x00b4d8,
    dialog: [
      "Hey! Want to take a kite up and see who else is flying right now?",
      "Stay airborne to rack up points. The further out you let your line, the faster you score.",
      "But flying high makes you an easy target. Cut a rival's line for a bonus, if you dare.",
    ],
    action: { type: "minigame", label: "Launch Kite", miniGameId: "kite-clash" },
    spriteKey: "Kite Pro",
    // Idle-loop sheet: 8 frames (57x97 each), always facing south, never
    // wanders. DOM re-exported at ~half the old resolution, so scale 0.5
    // renders the character at ~the same on-screen size as before AND is
    // pixel-perfect (0.5 x zoom = integer → crisp, no downscale cracking).
    // blobOffsetX: feet center sits at x≈39 in the 57px frame (right of
    // center 28.5, to balance the kite string) — shift the blob +11 src px.
    spriteAnimation: { frameWidth: 57, frameHeight: 97, frameCount: 8, scale: 0.5, blobOffsetX: 11 },
  },
  {
    id: "swap-npc",
    name: "Jupiter Cat",
    role: "Token Swap",
    // On the sidewalk in front of the Jupiter building (BuildJupiter,
    // cols 91-101 / rows 17-32).
    tileX: 96,
    tileY: 32,
    color: 0x14f195,
    dialog: [
      "Want a different token? I can swap it for you.",
      "Pick what you have and what you want. Jupiter finds the best price.",
    ],
    action: { type: "swap", label: "Open swap" },
    spriteKey: "Jupiter Joe",
  },
  {
    id: "send-npc",
    name: "Steve Sends",
    role: "Send Tokens",
    // In front of the Solana City building (BuildSolanaCity, cols 73-83 /
    // rows 47-59); findNpcSpawn steps down to the first walkable row.
    tileX: 78,
    tileY: 59,
    color: 0x00d1ff,
    dialog: [
      "Need to send SOL to a friend?",
      "Paste their address, pick the amount, and it arrives in seconds.",
    ],
    action: { type: "transfer", label: "Send tokens" },
    spriteKey: "avatar-send-npc",
  },
  {
    id: "pratik",
    name: "Pratik",
    role: "Superteam Earn",
    // In front of the Superteam Earn tent (BuildSTEarn, cols 89-95 / rows 38-44).
    tileX: 92,
    tileY: 44,
    color: 0x9945ff,
    dialog: [
      "Want to get paid to build on Solana?",
      "Pick a bounty and do your best work. If the sponsor picks yours, you win USDC.",
    ],
    action: { type: "bounties", label: "Explore Earn" },
    spriteKey: "Pratik",
  },
  {
    id: "magic-man",
    name: "Magic Man",
    role: "MagicBlock Engineer",
    // In front of the MagicBlock building (BuildMagicBlock, base cols 88-95 /
    // rows 52-55).
    tileX: 91,
    tileY: 55,
    color: 0xc026d3,
    dialog: [
      "I keep the engine running. MagicBlock is what this whole city is built on.",
      "Every step you take is a transaction on a rollup, landing in milliseconds.",
      "I can move your USDC where nobody can read it, or show you how any of it works.",
    ],
    action: { type: "private-payment", label: "Open MagicBlock" },
    spriteKey: "Magic Man",
  },
  {
    id: "mech-handler",
    name: "Mech Builder",
    role: "Sol Mechs Hangar",
    // At the door of the Sol Mechs hangar (BuildSolMechs, cols 51-69 /
    // rows 47-58); findNpcSpawn steps down to the first walkable row.
    tileX: 59,
    tileY: 57,
    color: 0xff5468,
    dialog: [
      "Hey, I'm the Mech Builder. Welcome to the Sol Mechs hangar!",
      "Build a squad of three mechs, mix parts across chassis and take them into 3v3 battles.",
      "Warm up against the CPU or battle other players online. The rules are in the menu whenever you need them.",
    ],
    action: { type: "minigame", label: "Enter the Hangar", miniGameId: "sol-mechs" },
    // No spriteKey yet — falls back to the default avatar sheet until the
    // handler's own art is drawn. Same for the portrait: the Unity source
    // only ships 2048x2048 busts, well over this repo's 256x256 convention.
  },
  {
    id: "caramel-dog",
    name: "Caramel Dog",
    role: "Beach Mascot",
    // Open sand in the Superteam Brazil zone. Chosen so the wander box below
    // lands on 100% walkable beach — clear of the stands to the north and the
    // lighthouse to the east — so the dog never picks a blocked target and
    // stalls in place.
    tileX: 41,
    tileY: 85,
    color: 0xd2833c,
    dialog: [
      "Woof!",
      "The caramel dog wags its tail and trots down the beach.",
    ],
    action: { type: "placeholder", label: "Pet the dog" },
    spriteKey: "avatar-caramel-dog",
    spriteWalkKey: "avatar-caramel-dog-walk",
    // ~7 tiles. Keeps it roaming the open sand of the ST Brasil beach without
    // reaching the stands to the north or the water to the south.
    wanderRadius: 168,
  },
  {
    id: "stocks-broker",
    name: "Stocks Broker",
    role: "Sunrise Stock Exchange",
    // At the door of the Sunrise Stock Exchange in the north plaza
    // (world/StockExchange.ts, building cols 78-91 / rows 6-15); findNpcSpawn
    // lands on row 17.
    tileX: 84,
    tileY: 16,
    color: 0xffb547,
    dialog: [
      "Welcome to the Sunrise Stock Exchange!",
      "Buy real stocks as Solana tokens, from $1. Wall Street closes, Solana never does.",
    ],
    action: { type: "stock-exchange", label: "Open the exchange" },
    // No spriteKey yet: placeholder avatar until the broker's original art lands.
  },
  // ── Expansion district NPCs ──────────────────────────────────────
  {
    id: "kuka",
    name: "Kuka",
    role: "Superteam Brazil Lead",
    // In front of the ST Brasil lighthouse, on the sidewalk between the flag
    // lamp post and the welcome sign.
    tileX: 56,
    tileY: 87,
    color: 0xffd700,
    dialog: [
      "Hi, I'm Kuka, lead of Superteam Brazil!",
      "Brazil won 2 prizes at the Cypherpunk Hackathon. At the next one, we're going for even more!",
      "Get ready with our workshops at The Garage. Join us!",
    ],
    highlights: [
      { img: "/assets/minigames/kite/kites/kite_stb.png", label: "SUPERTEAM BR" },
      { img: "/assets/minigames/sol-mechs/ui/win-trophy.png", label: "2 PRIZES" },
      { img: "/assets/ui/ico_tasks.png", label: "WORKSHOPS" },
    ],
    action: { type: "link", label: "Follow @superteamBR", url: "https://x.com/superteamBR" },
    spriteKey: "Kuka",
  },
  {
    id: "bk-indies",
    name: "BK",
    role: "Indies on Solana",
    // On the sidewalk in front of the Indies on Solana storefront
    // (BuildIndies, base rows 40-45 around cols 59-68).
    tileX: 62,
    tileY: 45,
    color: 0x7c3aed,
    dialog: [
      "Hi, I'm BK from Indies on Solana!",
      "We help indie devs build games on Solana. Season 2 sign-ups are open!",
    ],
    highlights: [
      { img: "/assets/ui/controller.png", label: "INDIE GAMES" },
      { sheet: "BK.png", label: "BY INDIES" },
      { img: "/assets/minigames/sol-mechs/ui/win-trophy.png", label: "SEASON 2" },
    ],
    action: { type: "link", label: "Visit Indies on Solana", url: "https://indiesonsolana.com/" },
    spriteKey: "BK",
  },
  {
    id: "mr-bananas",
    name: "Mr. Bananas",
    role: "MonkeDAO",
    // In front of the banana stand at the MonkeDAO block (BuildMonkeDaoStand,
    // base cols 47-51 / rows 29-31).
    tileX: 49,
    tileY: 31,
    color: 0xffd700,
    dialog: [
      "Hey bro! I'm Mr. Bananas, and I'm bananas about MonkeDAO.",
      "Members help each other grow. Come join the community!",
    ],
    highlights: [
      { sheet: "Mr. Bananas.png", label: "MONKEDAO" },
      { img: "/assets/ui/ico_chat.png", label: "COMMUNITY" },
      { img: "/assets/ui/ico_achievements.png", label: "GROW TOGETHER" },
    ],
    action: { type: "link", label: "Visit MonkeDAO", url: "https://monkedao.io/" },
    spriteKey: "Mr. Bananas",
  },
];
