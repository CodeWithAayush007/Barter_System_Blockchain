/**
 * proof.js — `npm run proof`: show, straight from the blockchain, that things are really changing.
 *
 *   npm run proof            current block, contract balances / counters, and the last 15 transactions
 *   npm run proof -- 0xHASH  one transaction in detail: block, who sent it, which function, the events it emitted
 *
 * Run it before an action and again after it: the block number, the transaction hashes, the escrow
 * balances and the counters all move. Nothing here is stored in a database — it is read from the node.
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = hre;

const deployed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments.json"), "utf8")).contracts;
const NAMES = ["BarterToken", "Escrow", "BarterAgreement", "Reputation"];
const byAddress = {};
const ifaces = {};
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const fmt = (wei) => ethers.formatUnits(wei, 18);

async function load() {
  for (const n of NAMES) {
    const art = await hre.artifacts.readArtifact(n);
    ifaces[n] = new ethers.Interface(art.abi);
    byAddress[deployed[n].toLowerCase()] = n;
  }
}

function decode(tx) {
  const name = tx.to ? byAddress[tx.to.toLowerCase()] : null;
  if (!name) return { contract: tx.to ? short(tx.to) : "(deployment)", fn: "" };
  const parsed = ifaces[name].parseTransaction({ data: tx.data, value: tx.value });
  return { contract: name, fn: parsed ? parsed.name : "(unknown)" };
}

async function summary() {
  const p = ethers.provider;
  const block = await p.getBlock("latest");
  const token = new ethers.Contract(deployed.BarterToken, ifaces.BarterToken, p);
  const agr = new ethers.Contract(deployed.BarterAgreement, ifaces.BarterAgreement, p);
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log("  BLOCKCHAIN STATE  (read live from the node)");
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`  Latest block        #${block.number}`);
  console.log(`  Latest block hash   ${block.hash}`);
  console.log(`  Escrow holds        ${fmt(await p.getBalance(deployed.Escrow))} ETH   +   ${fmt(await token.balanceOf(deployed.Escrow))} BTK`);
  console.log(`  BTK total supply    ${fmt(await token.totalSupply())}   (rises when bonuses/starter BTK are minted, falls when stakes are burned)`);
  console.log(`  Listings on chain   ${await agr.totalListings()}`);
  console.log(`  Trade requests      ${await agr.totalRequests()}`);
}

async function recent(limit = 15) {
  const p = ethers.provider;
  const latest = await p.getBlockNumber();
  const rows = [];
  for (let n = latest; n >= 1 && rows.length < limit; n--) {
    const b = await p.getBlock(n, true);
    for (const tx of [...b.prefetchedTransactions].reverse()) {
      const r = await p.getTransactionReceipt(tx.hash);
      rows.push({ n, tx, r, time: b.timestamp });
      if (rows.length >= limit) break;
    }
  }
  console.log("\n  LAST TRANSACTIONS (newest first)");
  console.log("  " + "─".repeat(68));
  for (const { n, tx, r, time } of rows) {
    const d = decode(tx);
    console.log(`  block #${n}  ${new Date(time * 1000).toLocaleTimeString()}  ${r.status === 1 ? "✓ success" : "✗ REVERTED"}`);
    console.log(`    ${d.contract}${d.fn ? "#" + d.fn : ""}   from ${short(tx.from)}   gas ${r.gasUsed.toLocaleString("en-US")}`);
    console.log(`    hash ${tx.hash}`);
  }
  console.log("\n  Details of one transaction:  npm run proof -- <hash>");
}

async function detail(hash) {
  const p = ethers.provider;
  const tx = await p.getTransaction(hash);
  if (!tx) throw new Error(`No transaction ${hash} on this chain (was the chain restarted?)`);
  const r = await p.getTransactionReceipt(hash);
  const d = decode(tx);
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`  TRANSACTION ${hash}`);
  console.log("══════════════════════════════════════════════════════════════════════");
  console.log(`  Status       ${r.status === 1 ? "✓ success" : "✗ reverted"}`);
  console.log(`  Block        #${r.blockNumber}   (${r.blockHash})`);
  console.log(`  From         ${tx.from}`);
  console.log(`  To           ${tx.to}   [${d.contract}]`);
  console.log(`  Function     ${d.fn}`);
  console.log(`  ETH value    ${fmt(tx.value)}`);
  console.log(`  Gas used     ${r.gasUsed.toLocaleString("en-US")} of ${tx.gasLimit.toLocaleString("en-US")}`);
  console.log(`  Events emitted (${r.logs.length}):`);
  for (const log of r.logs) {
    const name = byAddress[log.address.toLowerCase()];
    let line = `    ${name || short(log.address)}: (unrecognised)`;
    if (name) {
      try {
        const e = ifaces[name].parseLog(log);
        const args = e.fragment.inputs.map((i, k) => `${i.name}=${typeof e.args[k] === "bigint" && /uint/.test(i.type) && e.args[k] > 10n ** 12n ? fmt(e.args[k]) : e.args[k]}`).join(", ");
        line = `    ${name}.${e.name}(${args})`;
      } catch { /* not in the ABI */ }
    }
    console.log(line);
  }
}

(async () => {
  await load();
  const hash = process.env.PROOF_HASH || process.argv.find((a) => /^0x[0-9a-fA-F]{64}$/.test(a));
  if (hash) return detail(hash);
  await summary();
  await recent();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
