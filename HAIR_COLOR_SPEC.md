# Hair colour

Any hairstyle, any of twenty colours, free to everyone.

Status: **shipped on the client.** The one piece waiting on the redeploy is a
guard in `update_look_session`, already applied to the Rust (see
[On chain](#on-chain)).

---

## Why it was cheap

Every hair sheet in the game is drawn with **exactly two colours** (the beard
is the one exception, at three): a main tone covering most of the ink, and a
single shading tone.

Better: some of the shipped sheets were **already palette swaps of each
other**, which is verifiable pixel for pixel.

| Pair | Silhouette | Shade placement |
| --- | --- | --- |
| `Black_hair` / `Brown_hair` | identical | identical |
| `Magawk_blue` / `_green` / `_red` | identical | identical |

Same geometry, same light and dark pixels, only the two hexes differ. The
artist was already doing the palette swap by hand and saving it as another
file. Nothing new was invented here; the client just does that step now.

## The palette

One table, `apps/web/src/game/config/hairPalette.ts`. Editing a hex there moves
the game world, the wardrobe, the portrait and the where-is card together.
There is no second copy.

A swatch carries **three** stops:

| Stop | Replaces |
| --- | --- |
| `main` | the sheet's majority colour |
| `highlight` | a minority colour **lighter** than the majority |
| `shadow` | a minority colour **darker** than the majority |

### Why three and not two

The art uses two opposite shading conventions:

```
Afro, Anime, Black, Brown, long, beard   main is DARK,  shade is LIGHTER
Avatar, Magawk                           main is LIGHT, shade is DARKER
```

A two-stop swatch mapped blindly onto both reads as a **dark maroon afro and a
bright red mohawk** from the same "Red". Resolving per sheet against its own
majority keeps the lighting each sheet was drawn with, and means **no sheet had
to be redrawn**.

### Nothing that shipped changed appearance

The first seven swatches are the ramps already in the art, lifted hex for hex.
Every style declares the swatch it was drawn in (`STYLE_DEFAULT_COLOR`), so a
style at its default resolves to a **no-op**: the original texture is used and
nothing is derived or allocated.

## The catalog collapse

Ten hair entries became seven.

| Removed | Now | Pixel-identical? |
| --- | --- | --- |
| `Brown_hair` | `Black_hair` + `brown` | yes, asserted |
| `Magawk_green` | `Magawk_blue` + `green` | yes, asserted |
| `Magawk_red` | `Magawk_blue` + `red` | yes, asserted |

`hairPalette.test.ts` decodes the **real PNGs** and asserts zero differing
pixels, so the claim cannot rot. The three sheets stay in the repo as that
test's fixtures; they are no longer preloaded, which is three fewer textures in
memory at boot.

Names dropped their colour with them: "Black Hair" is wrong the moment it can
be pink. `Black_hair` is now "Short Hair", `Magawk_blue` is "Mohawk",
`black_long` is "Long Hair", `brown_beard` is "Beard". **Ids are unchanged**,
so saves and the wire are unaffected.

### The index shift, and why it was safe exactly now

`boosterIndexTable()` derives from the enabled variant list, so removing
`Magawk_green` and `Magawk_red` **renumbers every index after them**. That is
normally forbidden: those indices are the bitset the program stores.

It was safe here because **they have never been deployed**, the same reasoning
recorded for `Cap_Sol` leaving the pool on 2026-09-21. `POOL_VERSION` is now 2.

> After the player_v3 redeploy writes these indices to chain, a removal
> renumbers cosmetics wallets already own. The append-only rule is absolute
> again from that moment.

## Memory

This is where the feature could have hurt, so it is worth stating plainly.

A hair layer on screen can differ from its sheet two ways: a hat erases part of
it, and a swatch repaints it. Both need a texture Phaser owns, and the
combinations multiply. Derived textures are 256x256 RGBA, **256 KiB each**.

```
before          10 styles x 17 hats          up to  170 textures ~  43 MiB
naive + colour  10 x 20 x 17                 up to 3400 textures ~ 870 MiB
```

Three things keep it down:

1. **Nothing is derived unless it has to be.** A style in the colour it was
   drawn in, under no hat, renders straight off the original texture. That is
   the common case and it allocates zero.
2. **One pass, not two.** Masking and recolouring happen in a single pass over
   the pixels, so a hat *plus* a colour still costs one texture rather than two
   chained ones.
3. **Reference counting.** Derived textures are freed when the last character
   wearing one is destroyed, the same contract `characterShadow.ts` uses.

Point 3 also **fixes a pre-existing leak**: `cappedHairTextureCache` was an
unbounded `Map` that only ever grew, and a crowd of pedestrians walks a lot of
it. Freeing also removes the walk animations registered against the texture,
without which re-acquiring the same hair reuses an animation pointing at a
destroyed texture and crashes the next `walk()`.

The crowd is bounded on purpose: 65% of pedestrians keep the colour their sheet
was drawn in (free), and the rest draw from seven naturals rather than all
twenty. A street of mint and pink mohawks also stops reading as a city.

### Why not a shader

`PhaserGame.tsx` runs `type: isMobile ? Phaser.CANVAS : Phaser.AUTO`. **Phones
are Canvas2D**, so there is no shader path on the platform that matters most.
Phaser's `setTint` was no good either: it is a single multiply and cannot move
two ramp stops independently.

## On chain

The swatch rides the loadout string as `c=<palette index>`, and **only when it
differs from the default**, so the usual outfit string does not get longer.

The index rather than the id is not golf. The string is capped at 120 bytes on
chain and a full outfit already runs over that, so `c=13` instead of
`c=chestnut` is six bytes that would otherwise push a layer off the end.
`HAIR_COLORS` is therefore **append-only**, exactly like the booster pool:
reordering it recolours the hair of everyone already wearing a swatch past the
edit. A test pins the shipped order.

`update_look_session` parses every slot's value as a catalog index and checks
it against the player's unlock snapshot. The colour is neither: its value is a
palette id, so parsing it as an index would fail and **reject the entire outfit
write**, and there is nothing to authorise because every swatch is free. The
guard that skips `c` is applied to `programs/sol-city/src/lib.rs` and ships
with the rest of player_v3.

`decodeLoadout` also runs `migrateHairColor`, because a peer still on an older
build broadcasts `Brown_hair` or a coloured Magawk. Without the rewrite they
render as no hair at all.

---

## Known issue, not caused by this work

The loadout string **already overflows its on-chain cap**, independent of hair
colour:

```
s=Dark_brown|e=Normal_orange|p=Grey_short_pants|t=Brazilian_shirt|
b=backpack_brown|a=Trader_shades|h=Magawk_blue|H=turkish_head

  127 / 120   worst case, default colour (no `c` slot at all)
  132 / 120   worst case, plus a colour
```

The field is `#[max_len(120)]` and the program calls `cap_bytes(loadout, 120)`,
which **truncates silently**. `hat` encodes near the end, so the symptom is
remote players missing their hats, which is exactly what abbreviating the keys
was meant to fix (`OnChainMultiplayer.ts`). It regressed as long item ids were
added. Roughly 0.1% of full 8-layer outfits are over the line.

Hair colour makes this **5 bytes worse in the worst case**, not 11, because of
the index encoding above. What it does not do is change who pays: `encodeLoadout`
now emits in a **fixed order with the colour last**, so a string that goes over
loses the colour before it loses a layer. Losing the colour renders the style as
drawn; losing the hat renders no hat. Only the absolute worst case, which is
already over the cap without any colour at all, still reaches a layer.

The v3 redeploy fixes this structurally by making the loadout
`slot=<catalog index>`, which drops the worst case to about 40 characters. Note
**the client does not send indices yet** (`encodeLoadout` still sends id
strings, which v3 rejects); that conversion is already item 3 of
`REDEPLOY_CHECKLIST.md`.

## Open

- **Hair still occupies booster pool indices** even though it can never drop
  (`FREE_ITEMS.hair` is `"*"`, and the draw skips free items). Removing it from
  the pool entirely would reclaim those bits, and the redeploy window is the
  only moment that is free. Not done: it was not asked for, and it is a
  separate decision from colour.
- **Colour is free and has no rarity**, matching the decision that hair itself
  carries neither. If it should ever become an unlock axis, `hairColorOf` and
  the wardrobe swatch row are the two places that would need a gate.
