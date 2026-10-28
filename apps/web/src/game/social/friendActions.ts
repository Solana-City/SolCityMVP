import { PublicKey } from "@solana/web3.js";
import { getNetwork } from "@/game/multiplayer/OnChainMultiplayer";
import { LINK_NONE, LINK_WANT, LINK_DECLINED } from "@/game/solana/instructions";
import { answeredInvite, invalidateFriends } from "./friends";

/**
 * The four things you can do about a friendship, as writes to your OWN
 * account on the rollup.
 *
 * None of them asks the player for anything. No wallet prompt, no fee, no
 * account to create first: the friend list is a field of the PlayerState they
 * already have and that is already delegated, so a friend action costs
 * exactly what sending a chat line costs, which is nothing.
 *
 * That is also why there are only two states to write. Inviting and accepting
 * are the same fact, "I want this person as a friend", and a friendship is
 * both sides holding it. Cancelling an invite and unfriending are the same
 * act too: drop your half.
 */

/**
 * ON. The player_v4 program carries `links` on PlayerState and
 * `set_link_session` writes them, both verified on the deployed bytecode.
 */
export const FRIENDS_ENABLED = true;

export type FriendAction = "invite" | "accept" | "decline" | "cancel" | "remove";

export type FriendResult =
  | { ok: true }
  | { ok: false; message: string };

const STATE: Record<FriendAction, number> = {
  invite: LINK_WANT,
  accept: LINK_WANT,
  decline: LINK_DECLINED,
  cancel: LINK_NONE,
  remove: LINK_NONE,
};

export async function runFriendAction(
  action: FriendAction,
  me: PublicKey,
  other: PublicKey,
): Promise<FriendResult> {
  const net = getNetwork();
  if (!net) return { ok: false, message: "The city is still connecting." };

  try {
    await net.setFriendLink(other, STATE[action]);
    // Answering an invite, either way, retires the remembered copy of it.
    if (action === "accept" || action === "decline") answeredInvite(me, other);
    invalidateFriends();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: (err as Error).message?.split("\n")[0] ?? "That did not go through.",
    };
  }
}
