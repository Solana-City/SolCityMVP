#!/usr/bin/env bash
#
# Builds the three programs the way CI does, then checks every file.
#
#   npm run programs:build        (or: bash scripts/build-programs.sh)
#
# Output: target/deploy/{sol_mechs,sol_city,sol_city_collectibles}.so, all
# sBPFv3. Those are the files to deploy; `anchor build` and Solana Playground
# both produce v0, which SIMD-0500 (Agave 4.4) refuses for deploy and upgrade.
#
# Needs the Agave CLI 4.3.0 or newer on PATH:
#   sh -c "$(curl -sSfL https://release.anza.xyz/v4.3.0/install)"
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(cargo build-sbf --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
MAJOR=${VERSION%%.*}
MINOR=$(echo "$VERSION" | cut -d. -f2)
if [ "$MAJOR" -lt 4 ] || { [ "$MAJOR" -eq 4 ] && [ "$MINOR" -lt 3 ]; }; then
  echo "cargo build-sbf $VERSION is too old for sBPFv3: install Agave 4.3.0 or newer." >&2
  exit 1
fi

# One invocation per program, collectibles last: see the Build step in
# .github/workflows/programs.yml for why a workspace build emits a stub.
cargo build-sbf --arch v3 --manifest-path programs/sol-mechs/Cargo.toml
cargo build-sbf --arch v3 --manifest-path programs/sol-city/Cargo.toml
cargo build-sbf --arch v3 --manifest-path programs/sol-city-collectibles/Cargo.toml

node scripts/verify-sbpf.mjs \
  target/deploy/sol_mechs.so \
  target/deploy/sol_city.so \
  target/deploy/sol_city_collectibles.so
