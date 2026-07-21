"use client";

import { useEffect } from "react";
import { soundManager } from "@/game/audio/SoundManager";
import { progressionBus } from "@/game/progression/progressionBus";

/**
 * Headless audio bridge — wires game/progression events to synthesized SFX.
 * Renders nothing; pure side-effect, mounted once in page.tsx.
 *
 *   - Unlocks the AudioContext on the first user gesture (browsers keep it
 *     suspended until then).
 *   - A delegated pointerdown gives every <button> a UI click with one
 *     listener instead of wiring each call site.
 *   - progressionBus discrete events (swap/transfer/bounty confirm, unlock,
 *     achievement) map to their sounds — deliberately NOT position updates,
 *     which fire constantly and are already coalesced in the tx log.
 *   - Game-bus events (emote, minigame result, npc dialog) map through too.
 */
export default function AudioBridge({ game }: { game: Phaser.Game | null }) {
  // Unlock on first gesture + delegated button-click SFX.
  useEffect(() => {
    const unlock = () => soundManager.unlock();
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });

    const onPointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("button")) soundManager.play("click");
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

  // Game-bus events → SFX (minigame result, dialog open). Emote SFX lives
  // in showEmoji() itself so both the hotkey and chat-button paths cover it.
  useEffect(() => {
    if (!game) return;
    const onDialog = () => soundManager.play("dialog");
    const onResult = ({ success }: { success: boolean }) =>
      soundManager.play(success ? "success" : "error");

    game.events.on("npc:interact", onDialog);
    game.events.on("minigame:result", onResult);
    return () => {
      game.events.off("npc:interact", onDialog);
      game.events.off("minigame:result", onResult);
    };
  }, [game]);

  return null;
}
