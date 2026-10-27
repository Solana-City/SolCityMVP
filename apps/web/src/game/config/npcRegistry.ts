import { npcCategory, CATEGORY_META } from "../minimap/categories";
import type { Loadout } from "./paperDoll";
import type { BuffId } from "../buffs/playerBuffs";
import { isHalloweenOn } from "@/game/halloween/event";

export interface NPCAction {
  type: "tutor" | "swap" | "transfer" | "bounties" | "link" | "placeholder" | "private-payment" | "minigame" | "stock-exchange" | "peg-risk" | "token-scan" | "private-transfer" | "speed-buff" | "pet" | "ore-mine" | "donation" | "tea";
  label: string;
  url?: string;
  miniGameId?: string;
  orderType?: "sushi";
  /** Which timed buff a "speed-buff" action hands the player. */
  buffId?: BuffId;
  /** Prefilled recipient, when a transfer is opened from a player's card. */
  recipient?: string;
  /** That player's name, to show instead of the raw address. */
  recipientName?: string;
  /**
   * Which entry of the send catalog the transfer opens on (see sendTokens.ts).
   * The donation flow sets it, because a donation paid in practice devnet SOL
   * would reach nobody. Defaults to practice SOL when unset.
   */
  token?: string;
  /**
   * Which token a "swap" action opens BUYING, by symbol (see TOKEN_LIST in
   * jupiterSwap.ts). A partner's NPC sends players to their own token, so the
   * panel should not make them find it in the dropdown. Defaults to USDC.
   */
  swapTo?: string;
}

/** A picture + a word or two, shown on an NPC's last dialog line. */
export interface NPCHighlight {
  /** Image under /public, e.g. "/assets/minigames/kite/kites/kite_stb.png". */
  img?: string;
  /** Or a 256x256 character sheet in /assets/sprites (frame 0 is used). */
  sheet?: string;
  label: string;
}

/**
 * One page of an NPC's dialog.
 *
 * A plain string is the whole page. "
" inside it breaks the line where the
 * writer wants it rather than where the box happens to run out, which is the
 * difference between a line of speech and a paragraph.
 *
 * The object form closes the page with one sentence drawn in the NPC's own
 * colour, on its own line: the thing the player is meant to walk away with.
 */
export type NPCDialogLine = string | { text: string; accent: string };

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
  /**
   * Always the color of this NPC's category in the map legend (see
   * npcCategory/CATEGORY_META in categories.ts) — set below by NPC_REGISTRY's
   * mapping step, never authored per-entry, so it can't drift from the map.
   */
  color: number;
  dialog: NPCDialogLine[];
  action: NPCAction;
  /**
   * Phaser texture key for this NPC's sprite.
   * Falls back to "avatar-player" if not specified or not loaded.
   * Points to a spritesheet (same format as the player: 64×64 frames).
   */
  spriteKey?: string;
  /**
   * A paper-doll look, for a speaker who has no sheet of their own: the
   * citizen the Find Someone hunt puts in the crowd is assembled from layers
   * like the player, so their dialog portrait is drawn the same way.
   */
  loadout?: Loadout;
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
    /**
     * Frames per second of the loop. Defaults to 6, which is what every
     * static-animated NPC played at before one of them needed its own.
     *
     * The artists time these in milliseconds per frame and say so in the
     * filename, so write the division out (`1000 / 150`) rather than a
     * rounded decimal: it stays checkable against the sheet it came with.
     *
     * Phaser caches an animation under the texture's key, so two NPCs
     * sharing one sheet would also share whichever rate was created first.
     * Every sheet here belongs to a single NPC, so that cannot bite yet.
     */
    frameRate?: number;
  };
}

type NPCSeed = Omit<NPCDefinition, "color">;

const NPC_SEEDS: NPCSeed[] = [
  {
    id: "sol-guide",
    name: "Sol",
    role: "City Guide",
    // Central fountain plaza, three tiles down the path from the spawn steps.
    tileX: 78,
    tileY: 43,
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
    // In front of the food cart (GameAssetFoodCar, cols 26-29 / rows 46-49, solid
    // on its bottom two rows): on row 50, the first free row below it, at the
    // middle of its width (col 27, the second of its four columns, as before).
    // The artist moved the cart here from beside the log cabin, so he moved
    // with it. findNpcSpawn stands him on tileY + 1.
    tileX: 27,
    tileY: 49,
    dialog: [
      "Irasshaimase! Welcome to my cart.",
      "Customers are hungry. Build their sushi sets in order, before time runs out!",
    ],
    action: { type: "minigame", label: "Start cooking!", miniGameId: "food-cart", orderType: "sushi" },
    spriteKey: "Sushi Man",
  },
  {
    id: "vietnamese-barista",
    name: "Vietnamese Barista",
    role: "Superteam Vietnam",
    // In front of the coffee shop (BuildSTVN, cols 107-113 / rows 38-44), a
    // tile left of its centre, on the same row as Pratik and the Sushi Man.
    tileX: 109,
    tileY: 44,
    dialog: [
      "Xin chao! Welcome to the coffee shop, brought over by Superteam Vietnam.",
      "One cup of our famous coffee and you will not walk around the city. You will fly through it.",
    ],
    highlights: [
      { label: "+70% SPEED" },
      { label: "3 MINUTES" },
    ],
    action: { type: "speed-buff", label: "Try vietnamese coffee", buffId: "vietnamese-coffee" },
    spriteKey: "Vietnamese Barista",
  },
  {
    id: "dombra-artist",
    // The id and the spriteKey keep the name the sheet arrived under: the id
    // is what ?at= links and visit records are keyed by, and the key is the
    // filename BootScene loads. Only what players read changes.
    name: "Aisulu",
    role: "Superteam Kazakhstan",
    // At the yurt's door. BuildSTKZ runs cols 26-32 / rows 14-20, solid across
    // its bottom three rows, so the south face is row 20 and she stands on the
    // clear ground directly below it, centred on the seven columns.
    //
    // tileY is the row ABOVE the one she stands on: findNpcSpawn starts its
    // scan at tileY + 1, so 21 here puts her on (29, 22), one row clear of the
    // doorway. That also keeps her world Y below the yurt layer's, which is
    // what draws her in FRONT of the yurt rather than behind its wall.
    tileX: 29,
    tileY: 21,
    // One page: the greeting in her own language, who she plays for, and the
    // invitation. Same shape as Kuka's, which is the other Superteam lead who
    // sends players to a timeline rather than into a panel.
    dialog: [
      "Sälem! I play the dombra for Superteam Kazakhstan. Follow us and see what we are building.",
    ],
    action: { type: "link", label: "Follow @superteamkz", url: "https://x.com/superteamkz" },
    spriteKey: "Dombra Artist",
    // Static animated, like Kite Pro: one row of 6 frames at 64x84, facing
    // south, never wandering. 150ms a frame, as the sheet was delivered.
    spriteAnimation: { frameWidth: 64, frameHeight: 84, frameCount: 6, frameRate: 1000 / 150 },
  },
  {
    id: "dom-tea",
    name: "DOM",
    role: "Tea Ceremony",
    // Provisional: the grass block in the north west of the city (GrassEmptyPlot
    // / VegetationEmptyPlot) that now holds the yurt (BuildSTKZ, cols 26-32,
    // rows 14-20), at the bottom left tip of the block, where the owner pointed:
    // col 25, with open grass on every side and no vegetation painted on it.
    // findNpcSpawn stands him on tileY + 1, so row 28 here puts him on (25, 29).
    //
    // His first spots were derived from the food cart being at col 110, which
    // it has not been for some time, and the next one, beside the yurt's east
    // wall, was the owner's own pick before the yurt was there.
    tileX: 25,
    tileY: 28,
    dialog: [
      "I'm DOM. Welcome to my Tea Ceremony!",
      "Drinking tea gives you more energy, but without instability.",
    ],
    highlights: [
      { label: "+40% SPEED" },
      { label: "5 MINUTES" },
    ],
    action: { type: "tea", label: "Drink the tea" },
    spriteKey: "DOM",
    // Static animated, like Kite Pro: one row of 6 frames at 64x64, seated at
    // the tea set, facing south, never wandering.
    spriteAnimation: { frameWidth: 64, frameHeight: 64, frameCount: 6 },
  },
  {
    id: "kite-pro",
    name: "Kite Pro",
    role: "Kite Clash",
    // Superteam Brazil zone — out on the open sand, south of the market
    // stands, where there is vertical room for the kite.
    tileX: 40,
    tileY: 79,
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
    role: "Swap and Send",
    // On the sidewalk in front of the Jupiter building (BuildJupiter,
    // cols 91-101 / rows 17-32).
    tileX: 96,
    tileY: 32,
    dialog: [
      "Want a different token, or need to send one to a friend?",
      "I do both. Swap at the best price Jupiter can find, or send SOL, USDC, USDT and more.",
    ],
    // Opens on the swap tab; the send tab is one tap away inside the panel,
    // and a player's card opens the same panel straight on send.
    action: { type: "swap", label: "Open swap" },
    spriteKey: "Jupiter Joe",
  },
  {
    id: "donation-manager",
    name: "Donation Manager",
    role: "Support the Project",
    // The corner Steve Sends left when sending moved in with Jupiter Cat:
    // in front of the Solana City building (BuildSolanaCity, cols 73-83 /
    // rows 47-59); findNpcSpawn steps down to the first walkable row.
    tileX: 78,
    tileY: 59,
    dialog: [
      "Hi! I look after the wallet that keeps this city getting built.",
      "Anything you send there is a donation to the team. It is not a purchase, and it buys you nothing in the game.",
      {
        text: "Give if you want to support the work. The board shows who has.",
        accent: "Donations buy nothing. No items, no advantages.",
      },
    ],
    action: { type: "donation", label: "Open donations" },
    spriteKey: "Donation Manager",
  },
  // Steve Sends's sprite sheet (send-npc.png) stays in /assets/sprites for
  // whoever gets it next: the UI still draws it as the generic FRIEND avatar
  // in the action panel and the MagicBlock hub. It is NO LONGER on the Sending
  // achievement, which wears the send icon now that he has moved out.
  {
    id: "vibhu",
    name: "Vibhu",
    role: "Breakpoint 2026",
    // In front of his Breakpoint 26 stand (BuildStandBP26, cols 88-95 / rows
    // 38-43), centered on it: the middle falls on the boundary between cols 91
    // and 92, hence the half-tile nudge. tileY is the row ABOVE the one he
    // stands on (findNpcSpawn scans down from tileY + 1), so he stands on 44.
    tileX: 91,
    tileY: 43,
    offsetX: 12,
    dialog: [
      {
        text: "I'm Vibhu, the biggest promoter of Solana Breakpoint 2026!\nUse my code and you get 25% off your tickets to Breakpoint 2026.",
        accent: "BP26-VIBHU",
      },
      "Use this link to get this exclusive Solana T-shirt on SolanaCity.\nSee you in London!",
    ],
    highlights: [
      { label: "25% OFF" },
      { label: "SOLANA SHIRT" },
    ],
    action: {
      type: "link",
      label: "Get 25% off on BP26!",
      url: "https://bp26-vibhu.com/go/mazzabreno?v=2",
    },
    spriteKey: "Vibhu",
  },
  {
    id: "colosseum-supporter",
    name: "Colosseum Supporter",
    role: "Colosseum Hackathons",
    // In front of the Colosseum hall (BuildColosseum, cols 104-117 / rows
    // 9-21, solid from row 14), centered on it: the middle falls on the
    // boundary between cols 110 and 111, hence the half-tile nudge. tileY is
    // the row ABOVE the one he stands on, so he stands on row 22.
    tileX: 110,
    tileY: 21,
    offsetX: 12,
    dialog: [
      "Colosseum runs the hackathons where a lot of Solana's best projects started.",
      {
        text: "Hundreds of teams build in a few weeks, and the best of them end up in the hall of fame.",
        accent: "Go and see what they shipped.",
      },
    ],
    action: {
      type: "link",
      label: "See the Hall of Fame",
      url: "https://colosseum.com/arena/hackathon/hall-of-fame?hackathon=frontier",
    },
    spriteKey: "Cesar",
  },
  {
    id: "pratik",
    name: "Pratik",
    role: "Superteam Earn",
    // In front of the Superteam Earn tent (BuildSTEarn, cols 98-104 / rows 38-44).
    tileX: 101,
    tileY: 44,
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
    dialog: [
      "Hey, I'm the Mech Builder. Welcome to the Sol Mechs hangar!",
      "Build a squad of three mechs, mix parts across chassis and take them into 3v3 battles.",
      "Warm up against the CPU or battle other players online. The rules are in the menu whenever you need them.",
    ],
    action: { type: "minigame", label: "Enter the Hangar", miniGameId: "sol-mechs" },
    spriteKey: "Mech Builder",
    // Still no portrait: the Unity source only ships 2048x2048 busts, well
    // over this repo's 256x256 convention.
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
    dialog: [
      "Woof!",
      "The caramel dog wags its tail and trots down the beach.",
    ],
    // "pet" never opens a dialog: the petting square plays the moment the
    // player reaches the dog, because a dog that answers in sentences is a
    // worse dog. See PetOverlay.
    action: { type: "pet", label: "Pet the dog" },
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
    // At the door of the Remedi building (BuildRemedi, cols 113-123 / rows
    // 24-32), centered on its entrance; findNpcSpawn steps down to row 33,
    // the carpet in front of the doors.
    tileX: 118,
    tileY: 32,
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
    id: "seeker-lover",
    name: "Seeker Lover",
    role: "Solana Mobile",
    // At the door of the Seeker building (BuildSeeker, cols 104-111 / rows
    // 25-32), which replaced the energy plant he used to stand in front of.
    // tileY is the row ABOVE the one he stands on: findNpcSpawn starts its
    // scan at tileY + 1, so 32 here puts him on row 33, the first row below
    // the building.
    tileX: 108,
    tileY: 32,
    dialog: [
      "Hi! I'm Seeker Lover. That phone changed how I live in this city.",
      "You don't need the device to take my gift. Hold SKR in your wallet and it's yours.",
      "Talk to me once you have some, and check the phone out for yourself.",
    ],
    highlights: [
      { img: "/assets/ui/icon_wallet.png", label: "HOLD SKR" },
      { img: "/assets/ui/ico_wardrop.png", label: "FREE GIFT" },
      { img: "/assets/ui/controller.png", label: "NO PHONE NEEDED" },
    ],
    action: { type: "link", label: "See the Seeker", url: "https://solanamobile.com/seeker" },
    spriteKey: "Seeker Lover",
  },
  {
    id: "ore-miner",
    name: "ORE Miner",
    role: "ORE",
    // In front of his own building (BuildOre, cols 117-124 / rows 38-45), on
    // the left of the platform. Its body is solid down to row 43; row 46 below
    // is the top of the Keep Green machine, whose art would cover him, so he
    // stands on the platform's front edge. tileY is the row ABOVE the one he
    // stands on: findNpcSpawn scans from tileY + 1, so 44 puts him on row 45.
    tileX: 118,
    tileY: 44,
    dialog: [
      "(WIP) I'm still setting up the claim office, but you can look around.",
      "ORE runs a board of 25 squares. Miners put SOL on squares, and when the round closes the board pays out.",
      "A round lasts about a minute. Come watch one.",
    ],
    highlights: [
      { img: "/assets/ui/ico_tasks.png", label: "25 SQUARES" },
      { img: "/assets/ui/ico_achievements.png", label: "1 MIN ROUNDS" },
      { img: "/assets/ui/icon_wallet.png", label: "REAL SOL" },
    ],
    action: { type: "ore-mine", label: "See the board" },
    spriteKey: "ORE Miner",
    // Idle loop rather than a walk grid: one row of six 64x64 frames, the same
    // shape the Mole uses. He stands at his office and swings a pick.
    spriteAnimation: { frameWidth: 64, frameHeight: 64, frameCount: 6 },
  },
  {
    id: "mr-bananas",
    name: "Mr. Bananas",
    role: "MonkeDAO",
    // In front of the banana stand at the MonkeDAO block (BuildMonkeDaoStand,
    // base cols 47-51 / rows 29-31).
    tileX: 49,
    tileY: 31,
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
  {
    id: "guarana",
    name: "Guaraná",
    role: "Superteam Brasil Mascot",
    // The middle of the ST Brasil boardwalk, in the open band (rows 67-71)
    // between the Cloak stand to the north and the SolSentry and Pegana
    // stands to the south, with Kite Pro further down the beach. Every stand
    // he talks about is genuinely around him from here.
    tileX: 40,
    tileY: 69,
    dialog: [
      "Hey! I am Guaraná, the ST Brazil mascot.",
      {
        text: "Do you see all this stands around me?\nThey are real Brazilian projects on Solana.",
        accent: "Talk to all of them to get a special gift!",
      },
    ],
    highlights: [
      { label: "SUPERTEAM BRASIL" },
      { label: "MEET THE BUILDERS" },
    ],
    action: { type: "placeholder", label: "See you around!" },
    spriteKey: "Guarana",
    // Idle loop like Kite Pro: one row of 4 frames at 64x64, always facing
    // south, never wanders. The file drops the accent so the URL stays plain
    // ASCII; the name above is what players read.
    spriteAnimation: { frameWidth: 64, frameHeight: 64, frameCount: 4 },
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
    // On the sand in front of the Pegana stand (BuildStandPegana, cols 46-50
    // / rows 71-76): row 77, the first free row below it, at the middle of its
    // width (col 48).
    tileX: 48,
    tileY: 76,
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
    // 26-32 / rows 70-76): row 77, the first free row below it, at the middle
    // of its width (col 29).
    tileX: 29,
    tileY: 76,
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
    // In front of his own stand (BuildStandCloack, cols 40-46 / rows 60-66). It
    // faces south onto the boardwalk, so he stands on row 67, the first free row
    // below it, at the centre of its width (col 43). tileY is the row above the
    // one he stands on.
    tileX: 43,
    tileY: 66,
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
  {
    id: "jack-o-lantern",
    name: "Jack O' Lantern",
    role: "Halloween",
    // The event's window, and the only thing that takes him out of the city.
    // Evaluated once, at module load, which is also when the city places its
    // NPCs: a tab left open across the boundary keeps him until it reloads.
    enabled: isHalloweenOn(),
    // In front of the big tombstone in the Halloween park (DecorHalloweenTomb01,
    // cols 43-44, rows 41-43), which is two tiles wide, so he stands on the left
    // of its two doorstep tiles. findNpcSpawn stands him on tileY + 1, so row 43
    // here puts him on (43, 44): open grass, nothing painted or solid on it.
    tileX: 43,
    tileY: 43,
    dialog: [
      "Halloween came to Solana City, and my pumpkins rolled off all over it.",
      {
        text: "Bring one back and you get one go at my knife.",
        accent: "Carve the face clean and the Pumpkin Head is yours.",
      },
    ],
    // The three beats of the quest, as chips on his last line. The walkthrough
    // itself is the carving's how-to cards, which open on the first visit.
    highlights: [
      { label: "5 PUMPKINS" },
      { label: "1 CARVE EACH" },
      { label: "PUMPKIN HEAD" },
    ],
    // He hosts the Halloween mini-games. Pumpkin Carving is the first one in.
    action: { type: "minigame", label: "Carve a pumpkin", miniGameId: "pumpkin-carving" },
    spriteKey: "Jack O Lantern",
    // Idle loop like Guarana and the stand builders: one row of frames at
    // 64x64, always facing south, never wanders. The file drops the
    // apostrophe so the URL stays plain ASCII; the name above is what
    // players read.
    spriteAnimation: { frameWidth: 64, frameHeight: 64, frameCount: 28 },
  },
];

function categoryColor(npc: NPCSeed): number {
  return parseInt(CATEGORY_META[npcCategory(npc)].color.slice(1), 16);
}

export const NPC_REGISTRY: NPCDefinition[] = NPC_SEEDS.map((npc) => ({
  ...npc,
  color: categoryColor(npc),
}));
