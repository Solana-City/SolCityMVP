"use client";

/**
 * Sol Mechs, mounted on its own route.
 *
 * A test harness, not a game entrance: in the real build the mini-game is
 * launched from inside the city over the events bus, which means walking there
 * and re-walking after every reload. This mounts the same component directly
 * so a UI pass can be checked in one refresh.
 *
 * The wallet provider is still real, because the roster gate reads it — with
 * no pass sale configured it unlocks everything, which is the state the game
 * is meant to be tested in right now.
 */
import dynamic from "next/dynamic";

const SolanaProvider = dynamic(() => import("@/ui/SolanaProvider"), { ssr: false });
const SolMechs = dynamic(() => import("@/game/minigames/sol-mechs"), { ssr: false });

export default function DevSolMechsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#07030f" }}>
      <SolanaProvider>
        <SolMechs
          context={{ wallet: null }}
          onResult={async (r) => { console.log("[dev] sol-mechs result", r); }}
          onClose={() => { console.log("[dev] sol-mechs closed"); }}
        />
      </SolanaProvider>
    </main>
  );
}
