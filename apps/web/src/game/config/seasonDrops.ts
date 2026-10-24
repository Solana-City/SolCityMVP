import { getBoosterPool, isFreeInShippedGame } from "./paperDoll";
import { globalIndexOf } from "./catalogIndex";
import { rarityOf, seasonOf } from "./packs";
import { RARITY_ORDER, type Rarity } from "@/game/collections/seasons";

/**
 * What a season can drop, as catalog indices per rarity: the exact lists
 * `append_season_drops` is called with.
 *
 * One source for it, rather than a script computing it from the wardrobe
 * tables on its own, because getting it wrong is not recoverable. The indices
 * written to a season's drop table name cosmetics that land in wallets, and
 * the table stops being writable the moment the season opens.
 *
 * The rarity itself still comes from `rarityOf`, which reads a table of item
 * names in `packs.ts`. That is the thing being tuned while the art is drawn,
 * and it is why the program holds a list per rarity rather than four index
 * ranges: a list does not care what order the pool is in, or how many of each
 * rarity a season turns out to have.
 */
export function seasonDropLists(season: number): Record<Rarity, number[]> {
  const out = Object.fromEntries(
    RARITY_ORDER.map((r) => [r, [] as number[]]),
  ) as Record<Rarity, number[]>;

  for (const { category, variant } of getBoosterPool()) {
    // Rarity means nothing on an item everybody already has.
    if (isFreeInShippedGame(category, variant.id)) continue;
    if (seasonOf(variant) !== season) continue;
    out[rarityOf(category, variant.id)].push(globalIndexOf(category, variant.id));
  }

  // Sorted to match how the program stores them: `append_season_drops` keeps
  // each list sorted and deduplicated, so a seed computed here and the account
  // it produces read the same whatever order the pool was walked in.
  for (const r of RARITY_ORDER) out[r].sort((a, b) => a - b);
  return out;
}

/** How many items of each rarity a season holds. The sanity check behind the
 *  odds, and what the dev panel would show. */
export function seasonDropCounts(season: number): Record<Rarity, number> {
  const lists = seasonDropLists(season);
  return Object.fromEntries(
    RARITY_ORDER.map((r) => [r, lists[r].length]),
  ) as Record<Rarity, number>;
}
