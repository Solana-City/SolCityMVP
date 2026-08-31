"use client";

/**
 * Sol Mechs Season 1 Battle Pass sale.
 *
 * Its own route rather than a panel inside the city: this is the page a buyer
 * is linked to, and it has to load without walking the Phaser world first.
 */
import dynamic from "next/dynamic";

const SolanaProvider = dynamic(() => import("@/ui/SolanaProvider"), { ssr: false });
const PassSale = dynamic(() => import("@/ui/PassSale"), { ssr: false });

export default function PassPage() {
  return (
    <SolanaProvider>
      <PassSale />
    </SolanaProvider>
  );
}
