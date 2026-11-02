#!/usr/bin/env node
/**
 * Is this program sBPFv3, and is it the program it claims to be?
 *
 * The same checks as verify-sbpf.sh, in plain Node so they run anywhere the
 * web app does: no readelf, no python, no solana CLI. CI runs it as a gate on
 * every artifact, and it is what to run on the .so before a deploy and on the
 * chain after one.
 *
 *   node scripts/verify-sbpf.mjs <file.so> [...]
 *   node scripts/verify-sbpf.mjs --onchain all [--url <rpc>]
 *   node scripts/verify-sbpf.mjs --onchain <program-id> [--url <rpc>]
 *
 * --url defaults to public devnet. Pass the mainnet RPC to check mainnet.
 *
 * Why it matters: SIMD-0500 (Agave 4.4) refuses v0, v1 and v2 for deploy,
 * upgrade and finalize. A build exits 0 whatever format it produced, and
 * `cargo build-sbf` still produces v0 unless told `--arch v3`.
 */
import { readFileSync } from "fs";

const PROGRAMS = {
  "sol-city": "HPvDFVnruSXHwKKP44eUvRh8oYqBaHCeQbK1sKWT1aU2",
  "sol-city-collectibles": "EptRxVBysFzJEz52r58c2yCkpDGvF55aBPj1eCkWaphz",
  "sol-mechs": "6sv4G2HuFdrcAFBRA2X4jTSRmZj2MJS5t66zRUqy5vxJ",
};

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  const out = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}

/** Returns true if every check passes. `expectId` names the id that must be inside. */
function check(label, elf, expectId) {
  console.log(`-- ${label}`);
  console.log(`   size ${elf.length} bytes`);
  let ok = true;
  if (elf.readUInt32BE(0) !== 0x7f454c46 || elf[4] !== 2) {
    console.log("   FAIL: not a 64-bit ELF");
    return false;
  }

  const flags = elf.readUInt32LE(48);
  if (flags === 3) {
    console.log("   sBPFv3 (e_flags 0x3)  OK");
  } else {
    console.log(`   FAIL: e_flags 0x${flags.toString(16)}, not v3. Refused on deploy once SIMD-0500 is active`);
    ok = false;
  }

  // v3 carries no dynamic linking at all (SIMD-0189).
  const phoff = Number(elf.readBigUInt64LE(32));
  const phentsize = elf.readUInt16LE(54), phnum = elf.readUInt16LE(56);
  let dynamicSegments = 0;
  for (let i = 0; i < phnum; i++) {
    if (elf.readUInt32LE(phoff + i * phentsize) === 2) dynamicSegments++; // PT_DYNAMIC
  }
  const shoff = Number(elf.readBigUInt64LE(40));
  const shentsize = elf.readUInt16LE(58), shnum = elf.readUInt16LE(60), shstrndx = elf.readUInt16LE(62);
  const dynamicSections = [];
  if (shoff && shnum && shstrndx < shnum) {
    const strtab = Number(elf.readBigUInt64LE(shoff + shstrndx * shentsize + 24));
    for (let i = 0; i < shnum; i++) {
      const nameOff = elf.readUInt32LE(shoff + i * shentsize);
      const end = elf.indexOf(0, strtab + nameOff);
      const name = elf.subarray(strtab + nameOff, end).toString("latin1");
      if ([".dynamic", ".dynsym", ".rel.dyn"].includes(name)) dynamicSections.push(name);
    }
  }
  if (dynamicSegments === 0 && dynamicSections.length === 0) {
    console.log("   no dynamic linking  OK");
  } else {
    console.log(`   FAIL: dynamic linking present (PT_DYNAMIC x${dynamicSegments}, ${dynamicSections.join(" ") || "no sections"})`);
    ok = false;
  }

  // The id is 32 raw bytes in the binary, not base58 text.
  const found = Object.entries(PROGRAMS).filter(([, id]) => elf.includes(b58decode(id)));
  for (const [name, id] of found) console.log(`   declare_id ${name} ${id}`);
  if (expectId && !found.some(([, id]) => id === expectId)) {
    console.log(`   FAIL: ${expectId} is not in this binary`);
    ok = false;
  } else if (!found.length) {
    console.log("   FAIL: no known program id in this binary");
    ok = false;
  }
  return ok;
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

async function account(url, key) {
  const r = await rpc(url, "getAccountInfo", [key, { encoding: "base64" }]);
  return r.value ? Buffer.from(r.value.data[0], "base64") : null;
}

const B58_ENCODE = (buf) => {
  let n = BigInt("0x" + buf.toString("hex"));
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = "1" + s; else break; }
  return s;
};

async function onchain(url, id) {
  const program = await account(url, id);
  if (!program) {
    console.log(`-- ${id}\n   FAIL: not deployed on ${url}`);
    return false;
  }
  // UpgradeableLoaderState::Program: u32 tag, then the ProgramData address.
  const programData = await account(url, B58_ENCODE(program.subarray(4, 36)));
  // ::ProgramData: u32 tag, u64 slot, Option<Pubkey>, then the ELF.
  return check(`${id} on ${url}`, programData.subarray(45), id);
}

async function main() {
  const args = process.argv.slice(2);
  const u = args.indexOf("--url");
  const url = u >= 0 ? args[u + 1] : "https://api.devnet.solana.com";
  const o = args.indexOf("--onchain");
  let ok = true;
  if (o >= 0) {
    const which = args[o + 1];
    const ids = which === "all" ? Object.values(PROGRAMS) : [which];
    for (const id of ids) ok = (await onchain(url, id)) && ok;
  } else {
    const files = args.filter((a) => !a.startsWith("--"));
    if (!files.length) {
      console.log("usage: node scripts/verify-sbpf.mjs <file.so> | --onchain <id|all> [--url <rpc>]");
      process.exit(2);
    }
    for (const f of files) ok = check(f, readFileSync(f), null) && ok;
  }
  console.log(ok ? "\nall checks passed" : "\nchecks FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
