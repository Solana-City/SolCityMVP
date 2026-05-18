export const metadata = {
  title: "Terms of Service — The Solana City",
  description: "Terms of Service for The Solana City",
};

export default function TermsPage() {
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
          Terms of Service
        </h1>
        <p style={{ color: "#444466", fontSize: 12, marginTop: 8 }}>
          Last updated: May 2025
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 32, fontSize: 14, lineHeight: 1.8, color: "#8888aa" }}>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>1. Acceptance</h2>
          <p>By accessing or using The Solana City (&ldquo;Sol City&rdquo;, &ldquo;the Game&rdquo;), you agree to these Terms. If you do not agree, do not use the Game.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>2. The Game</h2>
          <p>Sol City is a browser-based multiplayer game where in-game actions correspond to real transactions on the Solana blockchain. You are solely responsible for any blockchain transactions you sign.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>3. Wallets &amp; Transactions</h2>
          <p>You must provide your own Solana wallet. We never custody your funds. All transactions are irreversible once confirmed on-chain. We are not liable for lost funds due to user error, wallet compromise, or network failures.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>4. Risks</h2>
          <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>Blockchain transactions carry financial risk. Only use funds you can afford to lose.</li>
            <li>Smart contracts may contain bugs. Use at your own risk.</li>
            <li>Token prices are volatile. We make no investment recommendations.</li>
            <li>The game is in active development. Features may change or be removed.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>5. Prohibited Conduct</h2>
          <p>You agree not to:</p>
          <ul style={{ paddingLeft: 20, marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <li>Exploit bugs or use bots to gain unfair advantages</li>
            <li>Harass other players</li>
            <li>Attempt to manipulate or attack the game&apos;s smart contracts</li>
            <li>Use the game for money laundering or other illegal activities</li>
          </ul>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>6. Intellectual Property</h2>
          <p>All game assets, code, and branding are owned by The Solana City. You may not reproduce, distribute, or create derivative works without permission.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>7. Disclaimer of Warranties</h2>
          <p>The Game is provided &ldquo;as is&rdquo; without warranties of any kind. We do not guarantee uptime, accuracy of on-chain data, or fitness for any particular purpose.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>8. Limitation of Liability</h2>
          <p>To the maximum extent permitted by law, we are not liable for any indirect, incidental, or consequential damages arising from your use of the Game, including loss of funds.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>9. Governing Law</h2>
          <p>These Terms are governed by applicable law. Disputes shall be resolved through binding arbitration where permitted.</p>
        </section>

        <section>
          <h2 style={{ color: "#ccccee", fontSize: 16, marginBottom: 12 }}>10. Contact</h2>
          <p>
            Questions?{" "}
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
