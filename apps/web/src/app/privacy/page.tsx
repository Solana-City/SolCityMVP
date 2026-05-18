export const metadata = {
  title: "Privacy Policy — The Solana City",
  description: "Privacy Policy for The Solana City",
};

export default function PrivacyPage() {
  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "48px 24px",
        fontFamily: '"Fira Code", monospace',
        color: "#ccccee",
        background: "#06080e",
        minHeight: "100vh",
      }}
    >
      <div style={{ marginBottom: 40 }}>
        <div style={{ color: "#9945FF", fontSize: 11, letterSpacing: 3, textTransform: "uppercase", marginBottom: 8 }}>
          The Solana City
        </div>
        <h1 style={{ color: "#ffffff", fontSize: 28, fontWeight: "bold", margin: 0 }}>
          Privacy Policy
        </h1>
        <p style={{ color: "#444466", fontSize: 12, marginTop: 8 }}>
          Last updated: May 2025
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 32, fontSize: 14, lineHeight: 1.8, color: "#8888aa" }}>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>1. Overview</h2>
          <p>
            The Solana City (&ldquo;Sol City&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is a multiplayer browser-based game built on the Solana blockchain.
            This policy explains what data we collect, how we use it, and your rights as a user.
          </p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>2. Data We Collect</h2>
          <p><strong style={{ color: "#ccccee" }}>Wallet address.</strong> When you connect a Solana wallet, we read your public key to identify your in-game character. We never access your private key, seed phrase, or signing credentials — all signing happens inside your wallet app.</p>
          <p style={{ marginTop: 12 }}><strong style={{ color: "#ccccee" }}>On-chain activity.</strong> Transactions you initiate (token swaps, SOL transfers, minigame settlements) are recorded on the Solana blockchain, which is public by design. We do not control or store this data.</p>
          <p style={{ marginTop: 12 }}><strong style={{ color: "#ccccee" }}>Display name &amp; avatar.</strong> Any display name or profile picture you set is stored in your browser&apos;s localStorage. It is not transmitted to our servers.</p>
          <p style={{ marginTop: 12 }}><strong style={{ color: "#ccccee" }}>Game state.</strong> Player position and in-game events are relayed through our multiplayer server to synchronise sessions. This data is ephemeral and not stored long-term.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>3. Data We Do Not Collect</h2>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>No name, email, or phone number</li>
            <li>No payment information</li>
            <li>No device identifiers or fingerprinting</li>
            <li>No location data</li>
            <li>No cookies beyond what the browser requires for the session</li>
          </ul>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>4. Third-Party Services</h2>
          <p>Sol City interacts with the following third-party services by design:</p>
          <ul style={{ paddingLeft: 20, marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <li><strong style={{ color: "#ccccee" }}>Solana Network</strong> — public blockchain; all transactions are public.</li>
            <li><strong style={{ color: "#ccccee" }}>Jupiter Aggregator</strong> — used for token swap quotes. Governed by Jupiter&apos;s own privacy policy.</li>
            <li><strong style={{ color: "#ccccee" }}>MagicBlock</strong> — ephemeral rollup for low-latency game actions. No personal data is shared.</li>
            <li><strong style={{ color: "#ccccee" }}>Vercel</strong> — hosting provider. May collect standard server access logs (IP address, request path, timestamp).</li>
          </ul>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>5. Data Retention</h2>
          <p>We do not operate a traditional database. Profile data lives in your browser&apos;s localStorage and is cleared when you clear your browser data. On-chain data is permanent and public by the nature of the Solana blockchain.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>6. Children</h2>
          <p>Sol City is not directed at children under 13. We do not knowingly collect data from children.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>7. Changes to This Policy</h2>
          <p>We may update this policy as the product evolves. The &ldquo;Last updated&rdquo; date at the top of this page reflects the most recent revision.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>8. Contact</h2>
          <p>
            Questions about this policy? Reach us at{" "}
            <a href="https://twitter.com/solanacity_" style={{ color: "#9945FF" }}>@solanacity_</a>
            {" "}on X (Twitter).
          </p>
        </section>
      </div>

      <div style={{ marginTop: 64, paddingTop: 24, borderTop: "1px solid rgba(153,69,255,0.15)", color: "#222244", fontSize: 11 }}>
        © 2025 The Solana City. Built on Solana.
      </div>
    </div>
  );
}
