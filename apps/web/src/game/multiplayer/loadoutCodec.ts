import { migrateHairColor, type Loadout, type LayerCategory } from "../config/paperDoll";
import { hairColorAtIndex, hairColorIndex } from "../config/hairPalette";
import { globalIndexOf, itemAtGlobalIndex, BOOSTER_BLOCK_START } from "../config/catalogIndex";
import { getOnChainUnlocks, unlockKeyOf } from "../config/wardrobeUnlocks";

/**
 * The loadout wire format, on its own so it can be tested without the
 * multiplayer module (which pulls in Phaser and needs a browser).
 */

// Loadout is encoded pipe/eq (NO quotes) — matches the on-chain PlayerState
// `loadout` String, capped at #[max_len(120)]. Category KEYS are abbreviated to
// one char so a FULL outfit (all 8 layers, incl. hat/accessory/back) fits under
// 120 — otherwise the last-encoded layer (hat) was truncated, which is exactly
// why remote players showed up without their hats. Decode accepts both the
// short keys and the old full-word keys so pre-existing loadouts still render.
const LOADOUT_KEY_ABBR: Record<string, string> = {
  skin: "s", hair: "h", eyesFace: "e", tshirt: "t",
  pants: "p", hat: "H", accessory: "a", back: "b",
  // Not a layer: the hair swatch (game/config/hairPalette.ts). Omitted
  // entirely when the style is worn in the colour it was drawn in, which is
  // the common case, so the usual loadout does not get longer.
  hairColor: "c",
};
const LOADOUT_ABBR_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(LOADOUT_KEY_ABBR).map(([full, abbr]) => [abbr, full]),
);
/**
 * Fixed emit order, hair colour LAST.
 *
 * The program caps this at 120 bytes with cap_bytes, which truncates the END,
 * and a full 8-layer outfit already runs over that (see HAIR_COLOR_SPEC.md,
 * "Known issue"). Object key order used to decide what fell off the cliff.
 * Pinning the order makes the colour the first casualty instead of a layer:
 * losing it renders the style as drawn, where losing the hat renders no hat.
 */
const LOADOUT_EMIT_ORDER: (keyof Loadout)[] = [
  "skin", "eyesFace", "pants", "tshirt", "back", "accessory", "hair", "hat", "hairColor",
];

/**
 * The loadout goes out as catalog indices, never variant ids.
 *
 * `WARDROBE_ONCHAIN.md` phase 2, ON since the security pass (audit R-10). The
 * program now REFUSES a value that is not an index, because skipping them was
 * what let any id through unchecked. Reading both formats shipped long before
 * this, so every client already understands the result.
 *
 * `wallet` is whoever is wearing it. A pack item is sent only if that wallet's
 * on-chain unlock list holds it, the list the program checks against, because
 * one unowned item makes the program refuse the WHOLE outfit and freezes the
 * player in their last look for everyone else. Better to drop the one item.
 */
export function encodeLoadout(l: Loadout, wallet: string | null): string {
  const owned = getOnChainUnlocks(wallet);
  const out: string[] = [];
  for (const k of LOADOUT_EMIT_ORDER) {
    const v = l[k];
    if (!v) continue;
    // The swatch goes as its palette index: "c=13" rather than "c=chestnut" is
    // six bytes that would otherwise push a layer past the cap.
    if (k === "hairColor") {
      const i = hairColorIndex(v);
      if (i >= 0) out.push(`c=${i}`);
      continue;
    }
    // The catalog index. An item with none (removed from the catalog since
    // the outfit was saved) is dropped: the program would refuse its id and
    // the whole outfit with it. Indices are also shorter, which buys room
    // against the 120-byte cap.
    //
    // The snapshot the program checks is kept current mid-session now:
    // sync_unlocks runs on the rollup (measured 2026-10-31), and the pack
    // overlay calls refreshUnlockSnapshot as soon as a draw lands.
    const index = globalIndexOf(k as LayerCategory, v);
    if (index < 0) continue;
    if (index >= BOOSTER_BLOCK_START && !owned.has(unlockKeyOf(k as LayerCategory, v))) continue;
    out.push(`${LOADOUT_KEY_ABBR[k] ?? k}=${index}`);
  }
  return out.join("|");
}
export function decodeLoadout(s: string): Loadout {
  const out: Loadout = {};
  for (const part of s.split("|")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const rawK = part.slice(0, i), v = part.slice(i + 1);
    const k = LOADOUT_ABBR_KEY[rawK] ?? rawK; // short key → full; full stays full
    if (!k || !v) continue;
    if (k === "hairColor") {
      // Numeric is what we send. A swatch id is accepted too: it is what the
      // first build to carry colour broadcast, and a peer may still be on it.
      const byIndex = /^\d+$/.test(v) ? hairColorAtIndex(Number(v)) : v;
      if (byIndex) out.hairColor = byIndex;
      continue;
    }
    // An index as well as an id, the same way hairColor above takes both.
    //
    // The wire is moving from variant ids ("h=Afro") to catalog indices
    // ("h=194"), because the program parses every value as a u16 and can only
    // enforce what it can read. Both are understood here for as long as it
    // takes every client to update: a service worker can keep an old build
    // alive for days, and a peer that cannot read the new format renders a
    // bald, naked avatar rather than a person.
    //
    // No ambiguity to resolve: no variant id is all digits.
    const asIndex = /^\d+$/.test(v) ? itemAtGlobalIndex(Number(v)) : undefined;
    // An index is only read in its OWN category's slot (audit R-38). Items in
    // different categories can share a variant id ("Pirate" is both a hat and
    // an accessory), so a hat's index sent in the accessory slot would
    // otherwise render as the same-named accessory, which the wearer may not
    // own. The program does not bind slots to categories; this is where it
    // matters, so this is where it is checked.
    if (asIndex && asIndex.category !== k) continue;
    (out as Record<string, string>)[k] = asIndex ? asIndex.variant.id : v;
  }
  // A peer on an older build still broadcasts Brown_hair or a coloured Magawk,
  // which are no longer wardrobe entries. Without this they render as no hair
  // at all, so the rewrite happens on the way in, not just on our own save.
  return migrateHairColor(out);
}
