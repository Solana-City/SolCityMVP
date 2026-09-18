/**
 * Chat link blocking. Links are the main scam vector in a crypto game chat
 * (fake airdrops, drainer sites, "support" Telegram groups), so the city chat
 * carries none: sending one is refused, and any that still arrive from a
 * modified client are masked before they are shown.
 */

/** Written-out dots people use to slip a domain past filters. */
const DOT = String.raw`(?:\.|\s*\[\s*\.\s*\]\s*|\s*\(\s*\.\s*\)\s*|\s+dot\s+|\s*\[dot\]\s*|\s*\(dot\)\s*)`;

const PATTERNS: RegExp[] = [
  // Anything with a scheme: https://, hxxp://, ftp://, solana:, ipfs://...
  /\b[a-z][a-z0-9+.-]{1,15}:\/\/\S*/gi,
  /\b(?:solana|ipfs|ipns|tg|discord):\S+/gi,
  // www.anything
  /\bwww\d?\s*(?:\.|\[\.\]|\(\.\))\s*\S+/gi,
  // domain.tld (optionally obfuscated) with an optional path. The TLD needs 2+
  // letters, so "1.5" or "e.g." pass but "claim.xyz" and "sol dot io" do not.
  new RegExp(String.raw`\b[a-z0-9-]+(?:${DOT}[a-z0-9-]+)*${DOT}[a-z]{2,24}\b(?:\/\S*)?`, "gi"),
];

/** Allowed "domain-like" words that are not links. */
const ALLOW = /^(?:e\.g|i\.e|etc|vs|mr|mrs|dr|st)\.?$/i;

function matches(text: string): string[] {
  const found: string[] = [];
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (!ALLOW.test(m[0])) found.push(m[0]);
    }
  }
  return found;
}

export function containsLink(text: string): boolean {
  return matches(text).length > 0;
}

/** Replaces every link with a neutral marker. */
export function maskLinks(text: string): string {
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (m) => (ALLOW.test(m) ? m : "[link removed]"));
  }
  return out;
}
