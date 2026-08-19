# Sol City — Map & Building Integration Guide

How to drop new city art into the game: **ST Brasil zone**, **replacing old
buildings**, or any new tileset. Written so integration is plug-and-play the
moment the Tiled/PNG files land.

The pipeline is: **edit in Tiled → export JSON → copy into `public/assets` →
register the tileset key in two code spots → verify.** Most of the work is in
Tiled; the code touches are tiny and listed below.

---

## Where things live

| What | Path |
|---|---|
| Map (desktop, full 200×200) | `apps/web/public/assets/maps/city.json` |
| Map (mobile, cropped) | `apps/web/public/assets/maps/city-mobile.json` |
| Tilesets (one PNG each) | `apps/web/public/assets/tilesets/<Key>.png` |
| Tileset load list | `apps/web/src/game/scenes/BootScene.ts` → `TILESET_KEYS` |
| Tileset bind list | `apps/web/src/game/scenes/CityScene.ts` → `allTilesets` (in `create()`) |
| NPC placement | `apps/web/src/game/config/npcRegistry.ts` (`tileX`/`tileY`) |

Facts: **tile size = 24px**, map is **200×200 tiles** (original coordinates).
There is no `.tmx` in the repo — the Tiled source is external; the repo only
holds the exported JSON. `SCBuildSTBrazil.png` is **already present**.

---

## Adding a new tileset (needed for any new art)

1. Drop `<Key>.png` into `apps/web/public/assets/tilesets/`.
2. Add `"<Key>"` to **`TILESET_KEYS`** in `BootScene.ts`. If the tileset has
   **no tiles in the mobile crop**, also add it to the `TILESET_KEYS_MOBILE`
   exclusion filter (see how `SCUrbanEquipament` / `SCBuildKeepGreen` are
   excluded).
3. Add `"<Key>"` to the **`allTilesets`** array in `CityScene.create()`. The
   name passed to `map.addTilesetImage(name, name)` **must match** the tileset
   name used in Tiled and the load key exactly.
4. In Tiled, add the same PNG as a tileset with the **same name**, paint with
   it, and **author collision** on solid tiles (Tiled tile-collision editor —
   the game reads it via `setCollisionFromCollisionGroup`, so collision is NOT
   coded, it's baked into the tileset).

That's the whole code side. Everything else is Tiled + re-export.

---

## Layer naming = behavior (the important convention)

The game decides how each Tiled layer renders **from its name prefix** and
whether its tiles have collision (see `CityScene.ts` lines ~106–184). Name
layers accordingly:

| Layer name starts with… | Has collision? | Result |
|---|---|---|
| `Build`, `Vegetation`, `DecorLight`, `GameAsset` | yes | **Y-sorted** — player walks in front when below it, behind when above. Use for buildings, trees, lamp posts. |
| `VegetationTree` | no | **Foreground canopy** — always above the player, fades when it would cover them. |
| anything else | yes | Always **behind** the player (large flat structures). |
| anything else | no | **Ground/background** — always below the player. |

So: **name building layers `Build...`** and give their solid tiles collision in
Tiled → they y-sort and block correctly with zero code. Ground/road/grass
layers keep any non-`Build`/`Vegetation` name and no collision.

Group layers in Tiled are fine — Phaser flattens them; only the tile-layer
**names** matter.

---

## Replacing old buildings

1. In Tiled, on the building's `Build...` layer, repaint the footprint with the
   new tileset's tiles (add the new tileset first if needed — see above).
2. Re-author collision on the new tiles (Tiled tileset collision editor).
3. Export `city.json` (and re-crop/export `city-mobile.json` — see Mobile).
4. **Review the hardcoded patches** (next section) if the building's footprint
   or nearby walkable area changed.

## Adding the ST Brasil zone

1. Paint the new area in Tiled using `SCBuildSTBrazil` (+ ground/veg tilesets).
   Keep it within the 200×200 bounds, or expand the map and re-check the mobile
   crop and spawn.
2. Building layers → `Build...` names + collision. Ground → non-collision.
3. New NPCs for the zone → add to `NPC_REGISTRY` with `tileX`/`tileY` in the new
   area (original 200×200 coords). Outfit-granting NPCs: set `unlockOutfit`
   (see the wardrobe unlock system).
4. Export both maps, register any new tileset key, verify.

---

## ⚠️ Hardcoded patches to review when the map changes

These are pinned to **specific tile coordinates**. If buildings move or the
fountain/MagicBlock area changes, update or remove them — otherwise they block
open ground or leak collision:

- **DecorFountain collision override** — `CityScene.ts` ~139–153: forces full
  collision on cols **95–103**, rows **91–99**, with a walk-through corridor at
  cols 99–100, rows 97+. Tied to the fountain's exact position.
- **MagicBlock invisible walls** — `CityScene.ts` ~204+: static wall rectangles
  patching a gap at cols **111–120**, rows 109–111. Tied to that building.
- **Spawn point** — `CityScene.ts` ~187–189: `col 99, row 97` (fountain plaza).
  If that tile is no longer open ground, move the spawn.

If the ST Brasil zone is a **new area** that doesn't touch these coordinates,
you can ignore them. If you **replace the fountain or MagicBlock building**,
update the matching patch.

---

## Mobile map (`city-mobile.json`)

Desktop loads `city.json`; touch devices load the **pre-cropped**
`city-mobile.json` (the `PLAYABLE_ZONE` sub-rectangle, with each layer carrying
`offsetx/offsety` so world-pixel positions still match the original 200×200
coords). When the map changes you must **re-export the mobile crop too**, or
mobile will show stale geometry. Tilesets with no tiles in the crop are excluded
via `TILESET_KEYS_MOBILE` in `BootScene.ts`.

---

## Verification checklist (after dropping files in)

- [ ] `npx tsc --noEmit` + `npm run build` pass (from `apps/web`).
- [ ] New tileset key is in **both** `TILESET_KEYS` (BootScene) and
      `allTilesets` (CityScene), spelled identically to Tiled.
- [ ] Load the app: no `[BootScene] <Key>.png missing` warning in the console.
- [ ] Buildings **block** the player and **y-sort** (walk behind the top, in
      front of the base). Roads/grass don't block.
- [ ] No invisible walls on open ground and no walk-through solid buildings
      (check the DecorFountain / MagicBlock patches if you touched those areas).
- [ ] Spawn lands on open ground.
- [ ] Mobile (`city-mobile.json` re-exported): same buildings/collision, no
      missing tiles.
- [ ] New-zone NPCs appear at the right tiles and are interactable.
