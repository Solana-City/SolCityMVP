#!/usr/bin/env bash
#
# Checks a built program artifact, or a deployed one, for the sBPF version it
# actually carries, plus the declare_id it was built with.
#
# Why this exists: SIMD-0500, expected in Agave 4.4 (November 2026), makes
# sBPFv3 the only format accepted for deploy, upgrade and finalize. Both of our
# programs are currently v0. A build can exit 0 and still be v0, so the header
# is the only thing worth trusting.
#
# Usage:
#   scripts/verify-sbpf.sh target/deploy/sol_city.so
#   scripts/verify-sbpf.sh --onchain HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2
#   scripts/verify-sbpf.sh --onchain-all
#
# Needs readelf. On macOS use the one from platform-tools:
#   ~/.cache/solana/v1.57/platform-tools/llvm/bin/llvm-readelf
# Point READELF at it if the system one is missing or too old.

set -uo pipefail

READELF="${READELF:-readelf}"
CLUSTER="${CLUSTER:-devnet}"

SOL_CITY_ID="HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2"
SOL_MECHS_ID="6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
warn()  { printf '\033[33m%s\033[0m\n' "$*"; }

need_readelf() {
  if ! command -v "$READELF" >/dev/null 2>&1; then
    red "readelf not found. Set READELF to a working one, for example:"
    echo "  READELF=~/.cache/solana/v1.57/platform-tools/llvm/bin/llvm-readelf $0 ..."
    exit 2
  fi
}

# A Playground download is NOT an ELF: it is a JSON map of index to byte.
# Convert it rather than failing with a confusing header error.
maybe_unwrap_json() {
  local src="$1"
  if [ "$(head -c 1 "$src")" = "{" ]; then
    local out="${TMPDIR:-/tmp}/$(basename "$src").elf"
    warn "  $src looks like a Playground JSON export, not an ELF. Converting."
    python3 -c "
import json, io, sys
d = json.load(io.open(sys.argv[1], encoding='utf-8'))
io.open(sys.argv[2], 'wb').write(bytes(d[str(i)] for i in range(len(d))))
" "$src" "$out" || { red "  conversion failed"; return 1; }
    echo "$out"
  else
    echo "$src"
  fi
}

check_file() {
  local raw="$1"
  [ -f "$raw" ] || { red "not found: $raw"; return 1; }

  local f; f="$(maybe_unwrap_json "$raw")" || return 1
  echo "── $raw"
  echo "   size: $(wc -c < "$f") bytes"

  local flags
  flags="$("$READELF" -h "$f" 2>/dev/null | grep -i '^\s*Flags:' | head -1)"
  echo "   $flags"

  local rc=0
  if echo "$flags" | grep -qE '0x3'; then
    green "   sBPFv3 ✓"
  elif echo "$flags" | grep -qE '0x0'; then
    red   "   sBPFv0 ✗  will be refused for deploy and upgrade once SIMD-0500 lands"
    rc=1
  else
    warn  "   unrecognised flags, read the header by hand"
    rc=1
  fi

  # A v3 ELF must carry no dynamic linking at all (SIMD-0189 forbids it).
  # Both of these have to come back empty.
  local dyn sec
  dyn="$("$READELF" -l "$f" 2>/dev/null | grep -c 'DYNAMIC')"
  sec="$("$READELF" -S "$f" 2>/dev/null | grep -cE '\.rel\.dyn|\.dynsym|\.dynamic')"
  if [ "$dyn" -eq 0 ] && [ "$sec" -eq 0 ]; then
    green "   no dynamic linking ✓"
  else
    red   "   dynamic linking present: PT_DYNAMIC x$dyn, link sections x$sec  (v0 shape)"
    rc=1
  fi

  # The declare_id trap: Playground rewrites it unless the Program ID is set in
  # Build & Deploy BEFORE building. The id is 32 raw bytes, not base58 text, so
  # grepping for the string finds nothing and proves nothing.
  python3 - "$f" "$SOL_CITY_ID" "$SOL_MECHS_ID" <<'PY'
import sys, io
A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def dec(s):
    n = 0
    for c in s: n = n * 58 + A.index(c)
    return n.to_bytes(32, "big")
blob = io.open(sys.argv[1], "rb").read()
hits = [(name, pid) for name, pid in (("sol-city", sys.argv[2]), ("sol-mechs", sys.argv[3]))
        if blob.count(dec(pid))]
if hits:
    for name, pid in hits:
        print(f"\033[32m   declare_id: {name} {pid} ✓\033[0m")
else:
    print("\033[31m   declare_id: NEITHER known program id is in this binary ✗\033[0m")
    print("\033[31m   Set the Program ID in Playground's Build & Deploy and rebuild.\033[0m")
    print("\033[31m   Never patch an id into a built .so: it is inlined in .text too.\033[0m")
PY
  return $rc
}

check_onchain() {
  local pid="$1"
  local out="${TMPDIR:-/tmp}/onchain-$pid.so"
  echo "── on chain: $pid ($CLUSTER)"
  if ! solana program dump "$pid" "$out" --url "$CLUSTER" >/dev/null 2>&1; then
    red "   dump failed. Is the solana CLI on PATH and the cluster reachable?"
    return 1
  fi
  check_file "$out"
}

need_readelf
rc=0
case "${1:-}" in
  --onchain)     check_onchain "${2:?program id required}" || rc=1 ;;
  --onchain-all) check_onchain "$SOL_CITY_ID" || rc=1
                 echo
                 check_onchain "$SOL_MECHS_ID" || rc=1 ;;
  "")            echo "usage: $0 <file.so> | --onchain <program-id> | --onchain-all"; exit 2 ;;
  *)             for f in "$@"; do check_file "$f" || rc=1; echo; done ;;
esac

echo
if [ $rc -eq 0 ]; then green "all checks passed"; else red "checks failed"; fi
exit $rc
