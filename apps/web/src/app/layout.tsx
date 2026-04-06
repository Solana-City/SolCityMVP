import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Solana City",
  description:
    "A multiplayer 2D city where every interaction is a real Solana transaction",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
