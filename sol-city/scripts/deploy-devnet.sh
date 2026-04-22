#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Sol City — Devnet Deploy
#
# Builds the Anchor program, deploys it to Solana devnet, and propagates the
# resulting program ID into every place it's referenced (Anchor.toml, the
# on-chain program's declare_id!, the TS client, and the web app's env).
#
# Idempotent: re-running after a successful deploy just upgrades in place.
#
# Prerequisites (all pinned to versions known to work):
#   - solana-cli   >= 1.18
#   - anchor-cli   == 0.30.1
#   - rustc + cargo (from Solana toolchain)
#   - A funded keypair at ~/.config/solana/id.json (at least 5 SOL on devnet)
#
# Usage:
#   scripts/deploy-devnet.sh            # full build + deploy
#   scripts/deploy-devnet.sh --upgrade  # upgrade existing program (same ID)
#   scripts/deploy-devnet.sh --dry-run  # check prereqs, don't deploy
# -----------------------------------------------------------------------------

set -euo pipefail

# ── Color helpers ──────────────────────────────────────────────────────────
BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GRN=$'\e[32m'
YLW=$'\e[33m'; BLU=$'\e[34m'; RST=$'\e[0m'

say()  { printf "%s▸%s %s\n" "$BLU" "$RST" "$*"; }
ok()   { printf "%s✓%s %s\n" "$GRN" "$RST" "$*"; }
warn() { printf "%s!%s %s\n" "$YLW" "$RST" "$*"; }
fail() { printf "%s✗%s %s\n" "$RED" "$RST" "$*" >&2; exit 1; }

# ── Flags ──────────────────────────────────────────────────────────────────
DRY_RUN=0
UPGRADE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --upgrade) UPGRADE=1 ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Unknown flag: $arg" ;;
  esac
done

# ── Paths ──────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ANCHOR_TOML="$ROOT/Anchor.toml"
PROGRAM_SRC="$ROOT/programs/sol-city/src/lib.rs"
TS_CLIENT="$ROOT/apps/web/src/game/solana/program.ts"
ENV_EXAMPLE="$ROOT/apps/web/.env.example"
ENV_LOCAL="$ROOT/apps/web/.env.local"
IDL_OUT_DIR="$ROOT/apps/web/src/game/idl"
IDL_SOURCE="$ROOT/target/idl/sol_city.json"

# ── Preflight ──────────────────────────────────────────────────────────────
say "${BOLD}Sol City — Devnet Deploy${RST}"
echo "${DIM}Working dir: $ROOT${RST}"
echo

say "Checking prerequisites..."

command -v solana  >/dev/null || fail "solana-cli not found. Install: https://docs.solana.com/cli/install"
command -v anchor  >/dev/null || fail "anchor-cli not found. Install: https://www.anchor-lang.com/docs/installation"
command -v cargo   >/dev/null || fail "cargo not found (comes with rustup)"
command -v jq      >/dev/null || warn "jq not installed — IDL post-processing will be skipped"

SOLANA_VER="$(solana --version | awk '{print $2}')"
ANCHOR_VER="$(anchor --version | awk '{print $2}')"
ok "solana-cli $SOLANA_VER"
ok "anchor-cli $ANCHOR_VER"

# Ensure we're on devnet
solana config set --url https://api.devnet.solana.com >/dev/null
ok "cluster = devnet"

# Keypair must exist and be funded
WALLET_PATH="${HOME}/.config/solana/id.json"
[[ -f "$WALLET_PATH" ]] || fail "No keypair at $WALLET_PATH. Run: solana-keygen new"

WALLET_ADDR="$(solana address)"
BALANCE_LAMPORTS="$(solana balance --lamports | awk '{print $1}')"
BALANCE_SOL="$(awk -v l="$BALANCE_LAMPORTS" 'BEGIN{printf "%.4f", l/1000000000}')"
ok "deployer = $WALLET_ADDR ($BALANCE_SOL SOL)"

if (( BALANCE_LAMPORTS < 2000000000 )); then
  warn "Balance below 2 SOL. Attempting airdrop..."
  solana airdrop 2 || warn "Airdrop rate-limited. Try: https://faucet.solana.com"
fi

if (( DRY_RUN == 1 )); then
  ok "dry-run OK — all prerequisites satisfied."; exit 0
fi

# ── Build ──────────────────────────────────────────────────────────────────
echo
say "Building program..."
anchor build

[[ -f "$IDL_SOURCE" ]] || fail "Build succeeded but IDL not found at $IDL_SOURCE"
ok "build complete"

# ── Program keypair ────────────────────────────────────────────────────────
# Anchor generates target/deploy/sol_city-keypair.json on first build.
# That keypair's pubkey IS the program ID.
PROGRAM_KEYPAIR="$ROOT/target/deploy/sol_city-keypair.json"
[[ -f "$PROGRAM_KEYPAIR" ]] || fail "Program keypair missing at $PROGRAM_KEYPAIR"

PROGRAM_ID="$(solana address -k "$PROGRAM_KEYPAIR")"
ok "program ID = $PROGRAM_ID"

# ── Patch declare_id! in source if stale ───────────────────────────────────
CURRENT_DECLARED="$(grep -oE 'declare_id!\("[^"]+"\)' "$PROGRAM_SRC" | sed -E 's/declare_id!\("(.+)"\)/\1/')"
if [[ "$CURRENT_DECLARED" != "$PROGRAM_ID" ]]; then
  say "Patching declare_id! in lib.rs..."
  # macOS and GNU sed compatibility via a temp file swap.
  TMP="$(mktemp)"
  sed -E "s#declare_id!\(\"[^\"]+\"\)#declare_id!(\"$PROGRAM_ID\")#" \
      "$PROGRAM_SRC" > "$TMP"
  mv "$TMP" "$PROGRAM_SRC"
  ok "declare_id! updated — rebuilding with correct ID"
  anchor build
fi

# ── Patch Anchor.toml ──────────────────────────────────────────────────────
if ! grep -q "sol_city = \"$PROGRAM_ID\"" "$ANCHOR_TOML"; then
  say "Patching Anchor.toml..."
  TMP="$(mktemp)"
  sed -E "s#^sol_city = \"[^\"]+\"#sol_city = \"$PROGRAM_ID\"#" \
      "$ANCHOR_TOML" > "$TMP"
  mv "$TMP" "$ANCHOR_TOML"
  ok "Anchor.toml updated"
fi

# ── Deploy ─────────────────────────────────────────────────────────────────
echo
if (( UPGRADE == 1 )); then
  say "Upgrading program on devnet..."
  anchor upgrade "$ROOT/target/deploy/sol_city.so" --program-id "$PROGRAM_ID" --provider.cluster devnet
else
  say "Deploying to devnet..."
  anchor deploy --provider.cluster devnet
fi
ok "on-chain — explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"

# ── Propagate to web client ────────────────────────────────────────────────
echo
say "Propagating program ID to web client..."

# TS client constant
TMP="$(mktemp)"
sed -E "s#\"[A-Za-z0-9]{32,44}\"  // Replace after first deploy#\"$PROGRAM_ID\"#" \
    "$TS_CLIENT" > "$TMP" || true
# Fallback: replace the first string literal inside the `new PublicKey(...)` of SOL_CITY_PROGRAM_ID.
# This regex targets the specific constant to avoid touching others.
python3 - "$TS_CLIENT" "$PROGRAM_ID" <<'PY'
import re, sys, pathlib
path, pid = pathlib.Path(sys.argv[1]), sys.argv[2]
src = path.read_text()
patched = re.sub(
    r'(export const SOL_CITY_PROGRAM_ID = new PublicKey\(\s*")[^"]+("\s*\);)',
    rf'\g<1>{pid}\g<2>',
    src,
    count=1,
)
path.write_text(patched)
PY
ok "program.ts updated"

# Env files (example + local)
for env_file in "$ENV_EXAMPLE" "$ENV_LOCAL"; do
  [[ -f "$env_file" ]] || continue
  if grep -q '^NEXT_PUBLIC_SOL_CITY_PROGRAM_ID=' "$env_file"; then
    TMP="$(mktemp)"
    sed -E "s#^NEXT_PUBLIC_SOL_CITY_PROGRAM_ID=.*#NEXT_PUBLIC_SOL_CITY_PROGRAM_ID=$PROGRAM_ID#" \
        "$env_file" > "$TMP"
    mv "$TMP" "$env_file"
    ok "$(basename "$env_file") updated"
  fi
done

# Copy IDL into web/src so the client can import it directly
say "Copying IDL to web client..."
mkdir -p "$IDL_OUT_DIR"
cp "$IDL_SOURCE" "$IDL_OUT_DIR/sol_city.json"
ok "IDL at apps/web/src/game/idl/sol_city.json"

# ── Summary ────────────────────────────────────────────────────────────────
echo
printf "%s%s=== Deploy complete ===%s\n" "$BOLD" "$GRN" "$RST"
printf "  Program ID: %s\n" "$PROGRAM_ID"
printf "  Cluster:    devnet\n"
printf "  Explorer:   https://explorer.solana.com/address/%s?cluster=devnet\n" "$PROGRAM_ID"
printf "\nNext steps:\n"
printf "  1. %scd apps/web && npm run dev%s\n" "$DIM" "$RST"
printf "  2. Open http://localhost:3000, connect wallet, move around.\n"
printf "  3. Open the on-chain log panel (top-right, next to PFP) to see live transactions.\n"
