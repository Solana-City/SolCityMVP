export interface NPCAction {
  type: "tutor" | "swap" | "transfer" | "bounties" | "link" | "placeholder" | "private-payment" | "minigame" | "stock-exchange" | "peg-risk" | "token-scan" | "private-transfer";
  label: string;
  url?: string;
  miniGameId?: string;
  orderType?: "sushi";
  /** Prefilled recipient, when a transfer is opened from a player's card. */
  recipient?: string;
  /** That player's name, to show instead of the raw address. */
  recipientName?: string;
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
  /**
   * Horizontal nudge in world pixels after the spawn tile is resolved, for
   * an NPC that must stand between two tiles (e.g. centered on a door
   * whose middle falls on a tile boundary). Defaults to 0.
   */
  offsetX?: number;
  /**
   * Vertical nudge in world pixels, negative being north. Same idea as
   * offsetX, for standing somebody on a step or a strip of ground that does
   * not line up with a tile centre. Defaults to 0.
   */
  offsetY?: number;
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
   * Optional one-frame sheet held for a moment when this NPC reacts — the
   * builder throwing an arm out as he pushes you back. Same frame size as
   * `spriteAnimation`, so it drops straight in over the idle sheet.
   */
  spriteActionKey?: string;
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
   * Nobody gets close. Come within `radius` world pixels — near enough to be
   * almost touching — and the player SLIDES back `push` pixels over `ms`,
   * decelerating, while the NPC says `say` in a bubble over its head.
   *
   * One shove per approach, not a wall: the push starts when the player
   * arrives and then plays out on its own, so it reads as being shoved
   * rather than as an invisible barrier pressing against them.
   *
   * An NPC with this never shows the "!" or the talk prompt: there is no
   * conversation to reach, and offering one the player cannot have is worse
   * than offering none.
   */
  repel?: { radius: number; push: number; ms: number; say: string };
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
    role: "Stocklana Exchange",
    // Centered at the foot of the Stocklana stairs (BuildStocklana, cols
    // 72-85 / rows 12-23). The steps (row 22) are solid, so findNpcSpawn
    // lands on row 23; the building's middle is the col 78/79 boundary,
    // hence the half-tile nudge.
    tileX: 78,
    tileY: 22,
    offsetX: 12,
    color: 0xffb547,
    dialog: [
      "Welcome to Stocklana!",
      "Buy real stocks as Solana tokens, from $1. Wall Street closes, Solana never does.",
    ],
    action: { type: "stock-exchange", label: "Open the exchange" },
    spriteKey: "Stocks Broker",
  },
  {
    id: "hair-specialist",
    name: "Hair Specialist",
    role: "Superteam Turkey",
    // At the door of the Remedi building (BuildRemedi, cols 103-113 / rows
    // 12-20), centered on its entrance; findNpcSpawn steps down to row 21,
    // the carpet in front of the doors.
    tileX: 108,
    tileY: 20,
    color: 0xe30a17,
    dialog: [
      "Merhaba! I'm the Hair Specialist, visiting from Superteam Turkey.",
      "Hairstyles fly by fast. Tap at the right moment to land one on your head!",
    ],
    action: { type: "minigame", label: "Try a new look", miniGameId: "hair-specialist" },
    spriteKey: "Hair Specialist",
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
  // ── ST Brasil builder stands ──────────────────────────────────────
  //
  // Projects that applied through the Superteam Brasil form and were
  // approved. Each one stands at its own stand on the beach and, where the
  // project has a public API, the panel behind the button is that API, not a
  // mock: Pegana reads peg state, SolSentry reads a token's risk.
  //
  // All three sheets are 6 frames of 64x64 in one row, idle in place, so they
  // carry spriteAnimation rather than a walk grid.
  {
    id: "pegana-raffx",
    name: "Raffx",
    role: "Pegana",
    // On the sand in front of the Pegana stand (BuildStandPegana, cols 40-46
    // / rows 71-76), two tiles clear of Kite Pro at 40/79.
    tileX: 43,
    tileY: 77,
    color: 0x00c2a8,
    dialog: [
      "I am Raffx. Pegana watches the peg on 69 stablecoins and LSTs.",
      "A coin holds its peg only while somebody is checking. We check in real time.",
      "Give me an asset and I read you its risk. No charge.",
    ],
    highlights: [
      { img: "/assets/ui/attention_red.png", label: "DEPEG ALERTS" },
      { img: "/assets/ui/ico_tasks.png", label: "69 ASSETS" },
    ],
    action: { type: "peg-risk", label: "Check a peg" },
    spriteKey: "Raffx",
    spriteAnimation: { frameWidth: 64, frameHeight: 64, frameCount: 6 },
  },
  {
    id: "solsentry-crash",
    name: "Crash",
    role: "SolSentry",
    // On the sand in front of the SolSentry stand (BuildStandSolSentry, cols
    // 26-32 / rows 70-76).
    tileX: 29,
    tileY: 77,
    color: 0xff5c5c,
    dialog: [
      "Pass me the address. I read the operator behind the token, not just the token.",
      "SolSentry calls the risk before the rug, and every call stays auditable.",
      "This one is free. No signup, no wallet.",
    ],
    highlights: [
      { img: "/assets/ui/attention_orange.png", label: "RUG SIGNALS" },
      { img: "/assets/ui/ico_achievements.png", label: "FREE SCAN" },
    ],
    action: { type: "token-scan", label: "Scan a token" },
    spriteKey: "Crash",
    spriteAnimation: { frameWidth: 64, frameHeight: 64, frameCount: 6 },
  },
  {
    id: "dungeons-moles",
    name: "Mole",
    role: "Dungeons & Moles",
    // At the mouth of the dungeon on its rock islet in the shallows west of the
    // beach (BuildDungeousMoles, cols 17-23 / rows 81-87; the artist moved the
    // cave here on 2026-09-26). The door is centred on col 20, under the D&M
    // sign between the two lanterns. The sand at its foot (row 86) is sealed
    // as part of the building, so he stands on row 87, the first walkable
    // row below it (the offsetY lifts him back toward the sand). Col 19 is one
    // tile left of the door centre so the doorway itself stays clear.
    //
    // tileY is the row ABOVE the one the NPC stands on: findNpcSpawn starts
    // its scan at tileY + 1. So 86 here puts him on row 87.
    tileX: 19,
    tileY: 86,
    offsetY: -8,
    color: 0xc98a3c,
    dialog: [
      "Every dungeon hides a path. Not every path wants to be found.",
      "The map does not exist yet. Take the first step and it appears.",
      "Keep digging. Some answers are deeper.",
    ],
    highlights: [
      { img: "/assets/ui/controller.png", label: "ROGUELITE" },
      { img: "/assets/ui/ico_achievements.png", label: "ON CHAIN LOOT" },
    ],
    // Half a tile left of centre and up onto the sand, so he stands beside
    // the treasure chest with the doorway clear behind him.
    offsetX: -6,
    action: { type: "link", label: "Enter the dungeon", url: "https://www.dungeonsandmoles.com/" },
    spriteKey: "Mole",
    spriteAnimation: { frameWidth: 64, frameHeight: 64, frameCount: 6 },
  },
  {
    id: "cloak-vitin",
    name: "Cloak Cat",
    role: "Cloak",
    // In front of his own stand (BuildStandCloack, art cols 32-38 / rows
    // 60-66, counter solid on cols 33-37). It faces south onto the boardwalk,
    // so he stands on row 67 at the centre of the counter (col 35). tileY is
    // the row above the one he stands on.
    tileX: 35,
    tileY: 66,
    color: 0x8b7cf6,
    dialog: [
      "Hey! I'm here to make privacy great again on Solana, can I count on you to do that?",
      "Cloak gives you a private balance: shield it once, then pay anyone without your wallet showing up as the sender.",
      "Shielding and sending are free. Only taking funds back out costs anything.",
    ],
    highlights: [
      { img: "/assets/ui/ico_achievements.png", label: "SHIELD" },
      { img: "/assets/ui/ico_chat.png", label: "PRIVATE SEND" },
    ],
    action: { type: "private-transfer", label: "Send privately" },
    spriteKey: "Cloak",
    spriteAnimation: { frameWidth: 64, frameHeight: 64, frameCount: 6 },
  },
  {
    id: "builder",
    name: "Builder",
    role: "Under Construction",
    // The fenced plot in the south east (cols 91-129 / rows 62-110), the one
    // opposite the ST Brasil beach. Every tile of it is solid, so he stands
    // on the road along its WEST edge (col 90, against the fence), at the
    // spot the artist marked on 2026-09-26 (row 75, about two tiles south of
    // the big tree's trunk). tileY is the row above the one he stands on.
    tileX: 90,
    tileY: 74,
    color: 0xffb547,
    // Never read: `repel` means the talk prompt never appears. Kept so the
    // registry stays uniform and the minimap has something to label.
    dialog: ["We are working here!"],
    action: { type: "placeholder", label: "Come back later" },
    // Just over a tile: the bodies are nearly touching before he reacts, so
    // the shove has something to answer. The slide is ~2.5 tiles.
    repel: { radius: 28, push: 60, ms: 380, say: "We are working here!" },
    spriteKey: "Builder",
    spriteActionKey: "Builder_push",
    spriteAnimation: { frameWidth: 64, frameHeight: 64, frameCount: 6 },
  },
];
