"use client";

/**
 * Kite Clash, mounted on its own route. A test harness like dev/sol-mechs:
 * the real entrance is the kite NPC on the beach, this skips the walk.
 */
import dynamic from "next/dynamic";

const KiteClash = dynamic(() => import("@/game/minigames/kite-clash"), { ssr: false });

export default function DevKiteClashPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0a14" }}>
      <KiteClash
        context={{ wallet: null }}
        onResult={async (r) => { console.log("[dev] kite-clash result", r); }}
        onClose={() => { console.log("[dev] kite-clash closed"); }}
      />
    </main>
  );
}
