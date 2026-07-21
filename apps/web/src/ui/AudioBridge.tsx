"use client";

import { useEffect } from "react";
import { soundManager, type Sfx } from "@/game/audio/SoundManager";
import { progressionBus } from "@/game/progression/progressionBus";

/**
 * Headless audio bridge — wires game/progression events to synthesized SFX.
 * Renders nothing; pure side-effect, mounted once in page.tsx.
 *
 *   - Unlocks the AudioContext on the first user gesture (browsers keep it
 *     suspended until then).
 *   - A delegated pointerdown gives every <button> a UI click with one
 *     listener. A button can opt out with data-sfx="off" (e.g. emoji
 *     buttons, which have their own emote sound) or request a different
 *     sound with data-sfx="outfit" etc.
 *   - progressionBus discrete events (swap/transfer/bounty confirm, unlock,
 *     achievement) map to their sounds — deliberately NOT position updates,
 *     which fire constantly and are already coalesced in the tx log.
 *   - Game-bus events (minigame win/lose, npc dialog, hunt found) too.
 */
export default function AudioBridge({ game }: { game: Phaser.Game | null }) {
  // Unlock on first gesture + delegated button-click SFX.
  useEffect(() => {
    const unlock = () => soundManager.unlock();
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });

    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      const btn = el?.closest("button") as HTMLButtonElement | null;
      if (!btn) return;
      const req = btn.dataset.sfx;          // data-sfx on the button
      if (req === "off") return;            // opts out (its own sound plays elsewhere)
      soundManager.play((req as Sfx) || "click");
    };
    window.addEventListener("pointerdown", onPointerDown, { capture: true });

    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true } as any);
      window.removeEventListener("keydown", unlock, { capture: true } as any);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
    };
  }, []);

  // Progression events → SFX.
  useEffect(() => {
    const offs = [
      progressionBus.on("swap",     () => soundManager.play("chime")),
      progressionBus.on("transfer", () => soundManager.play("chime")),
      progressionBus.on("bounty",   () => soundManager.play("chime")),
      progressionBus.on("outfit-unlocked",      () => soundManager.play("reward")),
      progressionBus.on("achievement-unlocked", () => soundManager.play("achievement")),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  // Game-bus events → SFX (minigame win/lose, dialog open, hunt found).
  // Emote SFX lives in showEmoji() so both hotkey and chat-button paths
  // cover it without doubling up on the delegated click.
  useEffect(() => {
    if (!game) return;
    const onDialog = () => soundManager.play("dialog");
    const onResult = ({ success }: { success: boolean }) =>
      soundManager.play(success ? "victory" : "error");
    const onFound = () => soundManager.play("victory");

    game.events.on("npc:interact", onDialog);
    game.events.on("minigame:result", onResult);
    game.events.on("whereIsNPC:found", onFound);
    return () => {
      game.events.off("npc:interact", onDialog);
      game.events.off("minigame:result", onResult);
      game.events.off("whereIsNPC:found", onFound);
    };
  }, [game]);

  return null;
}
