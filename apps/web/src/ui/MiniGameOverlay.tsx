"use client";

import React, { Suspense, useCallback, useEffect } from "react";
// Importing from the index triggers all registerMiniGame side-effects
import { getEntry } from "@/game/minigames";
import type { MiniGameContext, MiniGameResult } from "@/game/minigames";
import { requestLeave, resetLeaveGuard } from "@/game/minigames/leaveGuard";
import LeaveGameConfirm from "@/ui/LeaveGameConfirm";

// Module-level cache so React.lazy is called once per id — avoids Suspense re-triggering
const _lazyCache = new Map<string, React.LazyExoticComponent<React.ComponentType<any>>>();

function getLazyComponent(id: string): React.LazyExoticComponent<React.ComponentType<any>> | null {
  const entry = getEntry(id);
  if (!entry) return null;
  if (!_lazyCache.has(id)) {
    _lazyCache.set(id, React.lazy(entry.loader));
  }
  return _lazyCache.get(id)!;
}

interface MiniGameOverlayProps {
  id: string;
  context: MiniGameContext;
  onResult: (result: MiniGameResult) => Promise<void>;
  onClose: () => void;
}

export default function MiniGameOverlay({
  id,
  context,
  onResult,
  onClose,
}: MiniGameOverlayProps) {
  const GameComponent = getLazyComponent(id);

  // Every way out of a game comes through here, so this is where it is worth
  // asking. A game with nothing at stake — a menu, a finished match — leaves
  // immediately; one in the middle of a round asks first (see leaveGuard).
  const askThenClose = useCallback(() => requestLeave(onClose), [onClose]);

  // A stake belongs to a round, never to the next game the player opens.
  useEffect(() => resetLeaveGuard, [id]);

  if (!GameComponent) {
    console.error(`[MiniGameOverlay] No mini-game registered with id "${id}"`);
    return null;
  }

  return (
    <Suspense
      fallback={
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(6,10,20,0.88)" }}
        >
          <span style={{ color: "#9945FF", fontFamily: '"Press Start 2P", monospace', fontSize: 11 }}>
            Loading...
          </span>
        </div>
      }
    >
      {/* context cast: each component declares its own typed C — safe because manifest+launcher agree on shape */}
      <GameComponent context={context as any} onResult={onResult} onClose={askThenClose} />
      <LeaveGameConfirm />
    </Suspense>
  );
}
