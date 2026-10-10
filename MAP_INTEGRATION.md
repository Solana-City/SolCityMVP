# Sol City — Map & Building Integration Guide

How to drop new city art into the game: new zones, replacing old buildings, or
any new tileset. Written so integration is plug-and-play once the Tiled/PNG
files are ready.

The pipeline is: **edit in Tiled (external project) → export → embed
tilesets → patch collision → verify.** Most of the work is in Tiled; the
code/script touches are small and listed below.

---

## Where things live

| What | Path |
|---|---|
| Map (`SCMap01.1`, 135×115) | `apps/web/public/assets/maps/city.json` |
| Tilesets (one PNG each) | `apps/web/public/assets/tilesets/<Key>.png` |
| Tileset load list | `apps/web/src/game/scenes/BootScene.ts` → `TILESET_KEYS` |
| Tileset bind list | `apps/web/src/game/scenes/CityScene.ts` → `allTilesets` (in `create()`) |
| NPC placement | `apps/web/src/game/config/npcRegistry.ts` (`tileX`/`tileY`) |
| Tiled source project | **outside this repo** — on the map artist's machine (e.g. `SCMap01.1/`), with `Map/` (`.tmx` + `.tsx`), `SCAssets/` (the tileset PNGs), `Exports/` (Tiled's own JSON export) |

Facts: **tile size = 24px**, map is **135×115 tiles**. There is no `.tmx` in
this repo — the Tiled source lives entirely outside it; the repo only holds
the exported, embedded `city.json` and the tileset PNGs. There is currently
**no separate mobile crop** — one map serves both platforms.

---

## The export step Tiled doesn't do for you

Tiled's own **File → Export As** writes tilesets as *external references*
(`"source": "../Map/SCPalm.tsx"`), one per sibling file in `Exports/Tiles/`.
The game needs them **embedded** inline (name/tiles/image, no `source`) — a
raw Tiled export can't be dropped into `apps/web/public/assets/maps/` as-is.

Run the embed script against the exported `.tmj`, then the collision patch:

```bash
node apps/web/scripts/embed-tiled-map.mjs "<path to Exports/<Map>.tmj>"
node apps/web/scripts/patch-map-collision.mjs
```

(or `npm run map:embed -- "<path>"` / `npm run map:collision` from the repo
root). Copy any changed tileset PNGs into `apps/web/public/assets/tilesets/`
**before** running these — `embed-tiled-map.mjs` prints a reminder either way,
since it can't see the artist's local `SCAssets/` folder to diff hashes
itself.

If Tiled's *own* "Embed Tileset" option is used on export instead, the
`.tmj` won't have `source` pointers at all — `embed-tiled-map.mjs` passes
those tilesets through untouched, so the same two-command flow still works.

---

## Adding a new tileset (needed for any new art)

1. Drop `<Key>.png` into `apps/web/public/assets/tilesets/`.
2. Add `"<Key>"` to **`TILESET_KEYS`** in `BootScene.ts`.
3. Add `"<Key>"` to the **`allTilesets`** array in `CityScene.create()`. The
   name passed to `map.addTilesetImage(name, name)` **must match** the tileset
   name used in Tiled and the load key exactly.
4. In Tiled, add the same PNG as a tileset with the **same name**, paint with
   it, and **author collision** on solid tiles (Tiled tile-collision editor —
   the game reads it via `setCollisionFromCollisionGroup`, so collision is NOT
   coded, it's baked into the tileset).

That's the whole code side. Everything else is Tiled + re-export.

---

## Collision is per-tile-cell, not per-shape (read this before drawing thin objects)

The game uses Phaser **Arcade Physics**. Arcade tilemap collision is always
resolved against the tile's full 24×24 grid cell — the precise rectangle you
draw in Tiled's Tile Collision Editor only decides a yes/no per tile (does
this tile collide at all), never the exact geometry. A 7px-wide box drawn on
a tile still blocks the whole 24px cell.

**Practical rule: design solid parts of thin objects (trunks, posts, poles)
to occupy full 24px multiples**, and keep any part that should NOT block
(canopy, overhang) on tiles with **no** collision shape at all — same
approach already used for the market stall awnings (see `CANOPY_TOP_ROWS` in
`patch-map-collision.mjs`). Don't try to fix a "hitbox feels too big" report
by redrawing a smaller box in Tiled — it won't change anything at runtime;
the fix is always in how the art is laid out across tiles.

---

## Layer naming = behavior (the important convention)

The game decides how each Tiled layer renders **from its name prefix** and
whether its tiles have collision (see `CityScene.ts`, `create()`). Name
layers accordingly:

| Layer name starts with… | Has collision? | Result |
|---|---|---|
| `Build`, `Vegetation`, `DecorLight`, `GameAsset`, `Rock` | yes | **Y-sorted** — player walks in front when below it, behind when above. Use for buildings, trees, lamp posts. |
| `VegetationTree` | no | **Foreground canopy** — always above the player, fades when it would cover them. |
| `DecorSign` | no | **Y-sort without collision** — sits in front of buildings whose base is further north. |
| `DecorBilboard`, `DecorPalmBridge`, `DecorSTBrUmbrella`, `DecorSolanaUmbrella` | — | Always **above the player** — these are exact literal names hardcoded in `ABOVE_HEAD_PREFIXES`, not a generic rule. A new above-head object (a new umbrella brand, a new billboard) needs its own name added there. |
| `Collider*` (`ColliderInvisible`, `ColliderAuto`) | forced | Invisible, pure barrier. |
| anything else | yes/no per tile | Behind the player if it collides (flat structure like the fountain), ground/background if it doesn't. |

**Groups matter.** Tiled/Phaser reports a layer inside a group as
`GroupName/LayerName`. The rendering rules above match on the **leaf** name
(after the last `/`), so filing a layer inside a new group is safe for these.
**But `patch-map-collision.mjs`'s search for `ColliderInvisible` is not** —
it needs the exact leaf name too, and both it and `CityScene.ts` were fixed
for this once already (2026-08-31) after a layer got moved into a new group
and silently stopped blocking. If you reorganize layers into groups in
Tiled, re-run the verification checklist below — don't assume a rename-only
change.

---

## Verification checklist (after importing a new export)

- [ ] `node apps/web/scripts/embed-tiled-map.mjs "<export>.tmj"` then
      `node apps/web/scripts/patch-map-collision.mjs` — both exit clean, no
      `WARNING`/`refusing to open` lines.
- [ ] `npx tsc --noEmit` + `npm run build` pass (from the repo root or
      `apps/web`).
- [ ] New tileset key is in **both** `TILESET_KEYS` (BootScene) and
      `allTilesets` (CityScene), spelled identically to Tiled.
- [ ] Load the app: no `[BootScene] <Key>.png missing` warning in the console.
- [ ] Buildings **block** the player and **y-sort** (walk behind the top, in
      front of the base). Roads/grass don't block.
- [ ] No invisible walls on open ground and no walk-through solid buildings.
- [ ] Spawn (col 78, row 38 — the fountain plaza) lands on open ground.
- [ ] New-zone NPCs appear at the right tiles and are interactable.

---

## Animated buildings (prepared, not yet placed)

The Seeker building replaces the energy plant and arrives with an animation.
The asset is ready; nothing in the game references it yet, because the building
is not on the map.

### The asset

`public/assets/sprites/buildings/SCBuildSEEKER.png`, made from the artist's
strip with:

```bash
node apps/web/scripts/pack-animation-sheet.mjs "<...>/SCBuildSEEKER-Sheet.png" buildings/SCBuildSEEKER
```

| | |
|---|---|
| Frames | **87** |
| Frame | **72 x 103** |
| Grid | 28 x 4, read left to right then down, which is the order Phaser's `generateFrameNumbers` walks |
| Sheet | 2016 x 412 |
| Draw offset | x **60**, y **86** inside the artist's original 192 x 192 frame |

The offset matters when the building is positioned: the art was cropped out of
a mostly empty 192px frame, so anchoring to the crop puts it 60px left and 86px
up from where the uncropped frame would have placed it.

### Why it had to be repacked

The strip the artist exports is one row: 87 frames of 192px is **16704px wide**.
WebGL refuses any texture wider than `MAX_TEXTURE_SIZE`, which is 16384 on a
good desktop GPU and 8192 or 4096 on a lot of phones. That strip does not render
slowly, it does not render at all. Repacking is a requirement, not a tidy-up.

Every one of the 87 frames turned out to have an identical content box, so the
crop cannot shift the animation. That is checked on every run and the script
says so; if a future sheet reports more than one box, do not use the crop.

### What it costs

| | |
|---|---|
| Texture memory | **3.2 MB** packed, against 12.2 MB for the strip |
| CPU per frame | One animation step and a UV change. Nothing measurable for a single building |
| Draw calls | One, and only while it is on screen |

It does not undo the culling pass. `CityScene` already hides sparse layers,
pedestrians, NPCs and containers once they leave the camera, and the building
should go in alongside them so it stops drawing off screen.

One caveat worth knowing: Phaser keeps advancing an animation on a sprite that
is merely invisible. Culling saves the draw, not the tick. For one building the
tick is noise, but if it ever becomes a row of them, pause the animation when
culling rather than only hiding it.

### Still to decide when the building lands

- **Frame rate.** 87 frames at 12fps is a 7.25s loop. The artist's intended
  speed is not recorded anywhere.
- **Whether it loops** or plays once on approach.
- **Where the Seeker Lover stands.** He is at (106, 34) in front of the energy
  plant the Seeker building replaces, so he moves with it.
