"use client";

/** Test harness for the nickname window (a real wallet isn't needed to see it). */
import dynamic from "next/dynamic";

const SolanaProvider = dynamic(() => import("@/ui/SolanaProvider"), { ssr: false });
const NicknameModal = dynamic(() => import("@/ui/NicknameModal"), { ssr: false });

export default function DevNicknamePage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0a14" }}>
      <SolanaProvider>
        <NicknameModal wallet="11111111111111111111111111111111" current={null} forced onDone={(n) => console.log("[dev] name", n)} />
      </SolanaProvider>
    </main>
  );
}
