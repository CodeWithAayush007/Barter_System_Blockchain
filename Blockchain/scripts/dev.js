/**
 * dev.js — `npm run dev`: a complete local blockchain in ONE command.
 *
 *   1. starts a local Hardhat chain  (http://127.0.0.1:8545, chain id 31337)
 *   2. deploys + wires the 4 contracts
 *      and copies the addresses/ABIs into ../Frontend and ../backend_test
 *   3. (with --seed) creates a few demo listings and one pending request
 *   4. keeps the chain running until you press Ctrl+C
 *
 * Works the same on Windows, macOS and Linux (no shell tricks, only Node).
 *
 *   npm run dev          chain + deploy
 *   npm run dev:demo     chain + deploy + demo listings
 *
 * If a chain is already running on port 8545 it is reused: the contracts are
 * deployed onto it and this script exits (it doesn't own that process).
 */

const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const readline = require("readline");

const ROOT = path.join(__dirname, "..");
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const SEED = process.argv.includes("--seed");
const VERBOSE = process.argv.includes("--verbose"); // show every RPC call the chain logs
const HARDHAT = path.join(path.dirname(require.resolve("hardhat/package.json")), "internal", "cli", "bootstrap.js");

const log = (m = "") => console.log(m);
const tag = (m) => console.log(`[dev] ${m}`);

/** One JSON-RPC call over plain http (no dependencies, works on every Node version). */
function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const url = new URL(RPC_URL);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname || "/",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: 2000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            json.error ? reject(new Error(json.error.message)) : resolve(json.result);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end(body);
  });
}

const isUp = () => rpc("eth_chainId").then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs `hardhat <args>` and resolves with its exit code. */
function hardhat(args, opts = {}) {
  return spawn(process.execPath, [HARDHAT, ...args], { cwd: ROOT, stdio: "inherit", env: process.env, ...opts });
}
const runToEnd = (args) =>
  new Promise((resolve) => hardhat(args).on("exit", (code) => resolve(code ?? 1)));

let node = null;
let stopping = false;
let chainReady = false;

/**
 * Turns the Hardhat node's very chatty log into a short, readable one.
 *
 * The node prints one block of lines per JSON-RPC request. Most of them are noise:
 *
 *   • `eth_call` / `eth_estimateGas` are only SIMULATIONS — they never change the chain. Wallets such as
 *     MetaMask fire many of them on their own (balance / token / contract probes). Some are shaped like a
 *     contract deployment and make the node print "TransactionExecutionError: StackOverflow" or
 *     "function selector was not recognized". That is the wallet poking around, not a failed transaction,
 *     so those blocks are hidden.
 *   • Reads (`eth_getBalance`, `eth_blockNumber`, …) are hidden too.
 *
 * What IS shown (once the contracts are deployed):
 *   • one line per mined transaction  — ✓ for success, ✗ for a revert, with the reason;
 *   • a transaction the node REFUSED (wrong nonce, …) — with the fix, because that is what makes MetaMask say
 *     "transaction failed" after the chain was restarted.
 */
function createChainLogFilter() {
  const ANSI = /\x1b\[[0-9;]*m/g;
  const METHOD = /^[a-z0-9]+_[A-Za-z0-9_]+$/; // eth_call, eth_sendTransaction, hardhat_mine, …
  const out = (m) => console.log(`[chain] ${m}`);
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "?");
  let current = null; // { method, lines: [] }
  let timer = null;
  const hintsShown = new Set(); // each hint is printed once, not on every repeat

  function summarise(entry) {
    const { method, lines } = entry;
    const field = (label) => {
      const l = lines.find((x) => x.startsWith(label));
      return l ? l.slice(label.length).trim() : "";
    };
    const isSend = method === "eth_sendTransaction" || method === "eth_sendRawTransaction";
    if (!isSend || !chainReady) return; // simulations, reads and the deployment itself are not shown

    const mined = !!field("Transaction:"); // only a transaction that made it into a block has a hash line
    const FIELD = /^(Contract call|Contract deployment|Transaction|From|To|Value|Gas used):|^Block #\d+:/; // labels only — a reason such as "Transaction gas limit is …" is NOT a label
    const errorLine =
      lines.find((x) => /^(Error|[A-Za-z]*Error):/.test(x)) || // "Error: Transaction reverted: …"
      (mined ? "" : lines.find((x) => !FIELD.test(x)) || "unknown reason"); // refused before mining, e.g. "Nonce too high…"
    const clean = (t) => t.replace(/^(Error|[A-Za-z]*Error):\s*/, "");

    const name = field("Contract call:") || field("Contract deployment:") || "transaction";
    const from = short(field("From:"));
    const gas = field("Gas used:").split(" ")[0];
    const reason = clean(errorLine).replace(/^Transaction reverted:?\s*/i, "");

    if (!errorLine) {
      const hash = field("Transaction:");
      const block = (lines.find((x) => /^Block #\d+:/.test(x)) || "").match(/#(\d+)/);
      out(`✓ ${name}   from ${from}${gas ? `   gas ${Number(gas).toLocaleString("en-US")}` : ""}${block ? `   block #${block[1]}` : ""}`);
      if (hash) out(`    hash ${hash}`);
    } else if (mined) {
      out(`✗ ${name}   from ${from}   REVERTED${reason ? `: ${reason}` : ""}`);
    } else {
      out(`✗ ${name === "transaction" ? method : name}${from !== "?" ? `   from ${from}` : ""}   REFUSED by the node: ${clean(errorLine)}`);
      const hint = /nonce/i.test(errorLine)
        ? ["MetaMask still remembers the previous run of the chain (every restart starts it from zero).",
           "Fix: MetaMask → Settings → Advanced → \"Clear activity tab data\" (for each imported account), then try again."]
        : /too low for the next block|baseFeePerGas/i.test(errorLine)
        ? ["The network fee MetaMask picked was below the chain's current fee. Reject it and try again (MetaMask re-reads the fee),",
           "or in MetaMask's fee options choose \"Aggressive\"."]
        : /enough funds/i.test(errorLine)
        ? ["That wallet has too little ETH for the value + gas. Use one of the funded Hardhat accounts."]
        : /invalid chainId/i.test(errorLine)
        ? ["MetaMask is on the wrong network. Switch it to \"Hardhat Localhost\" (chain id 31337)."]
        : /gas cap/i.test(errorLine)
        ? ["The gas limit in MetaMask is above the 16,777,216 per-transaction cap. Lower the gas limit (or reset it to the suggested value)."]
        : null;
      if (hint && !hintsShown.has(hint[0])) {
        hintsShown.add(hint[0]);
        hint.forEach((h, i) => out(`   ${i === 0 ? "→" : " "} ${h}`));
      }
    }
  }

  function flush() {
    clearTimeout(timer);
    if (current) {
      try {
        summarise(current);
      } catch {
        /* a log-formatting problem must never break the dev server */
      }
      current = null;
    }
  }

  function push(raw) {
    if (VERBOSE) return out(raw);
    const line = raw.replace(ANSI, "").replace(/\s+$/, "");
    if (METHOD.test(line.trim()) && !/^\s/.test(line)) {
      flush();
      current = { method: line.trim(), lines: [] };
      timer = setTimeout(flush, 250); // the last block of a burst has no "next block" to close it
      return;
    }
    if (!current) {
      if (/Started HTTP/.test(line)) out(line);
      return; // the account list and warnings are repeated (more usefully) in the READY banner
    }
    if (line.trim()) current.lines.push(line.trim());
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }

  return { push };
}

function stop(code = 0) {
  stopping = true;
  if (node && !node.killed) node.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

function printReady() {
  let accounts = [];
  try {
    const { HDNodeWallet } = require("ethers");
    const phrase = "test test test test test test test test test test test junk";
    accounts = [0, 1, 2, 3].map((i) => HDNodeWallet.fromPhrase(phrase, "", `m/44'/60'/0'/0/${i}`));
  } catch {
    /* only used for the hint below */
  }

  log();
  log("══════════════════════════════════════════════════════════════");
  log("  LOCAL BLOCKCHAIN READY — contracts deployed");
  log("══════════════════════════════════════════════════════════════");
  log("  MetaMask → Add network (manually):");
  log(`     Network name    Hardhat Localhost`);
  log(`     RPC URL         ${RPC_URL}`);
  log(`     Chain ID        31337`);
  log(`     Currency        ETH`);
  if (accounts.length) {
    log();
    log("  MetaMask → Import account (private key). These are the public Hardhat TEST keys:");
    const names = ["#0  ADMIN (rules on disputes)", "#1  trader", "#2  trader", "#3  trader"];
    accounts.forEach((w, i) => {
      log(`     ${names[i]}`);
      log(`        ${w.address}`);
      log(`        ${w.privateKey}`);
    });
    log("  (Never use these keys on a real network.)");
  }
  log();
  log("  Then open the Tokens page and claim your 100 BTK before trading.");
  log("  Keep this window open — closing it stops the blockchain (Ctrl+C to stop).");
  log("══════════════════════════════════════════════════════════════");
  log("[dev] READY"); // the root launcher (npm run dev at the project root) waits for this line
}

async function main() {
  let ownNode = false;

  if (await isUp()) {
    tag(`A chain is already running at ${RPC_URL} — deploying onto it.`);
  } else {
    ownNode = true;
    tag("Starting the local blockchain (the first run also compiles the contracts and may download the Solidity compiler — this can take a minute)…");
    // The chain logs every single RPC call, which buries the useful output. The filter below keeps
    // only what matters (add --verbose to see everything the node prints).
    node = hardhat(["node"], { stdio: ["ignore", "pipe", "inherit"] });
    const chainLog = createChainLogFilter();
    readline.createInterface({ input: node.stdout }).on("line", chainLog.push);
    node.on("exit", (code) => {
      if (stopping) return;
      console.error(`\n[dev] The blockchain process stopped unexpectedly (code ${code}).`);
      console.error("[dev] If the message above mentions port 8545 being in use, another blockchain is already running — close it and try again.");
      process.exit(code || 1);
    });

    const started = Date.now();
    while (!(await isUp())) {
      if (Date.now() - started > 10 * 60 * 1000) {
        console.error("[dev] Timed out waiting for the blockchain to start.");
        return stop(1);
      }
      await sleep(500);
    }
  }

  tag("Deploying the contracts…");
  const deployCode = await runToEnd(["run", "scripts/deploy.js", "--network", "localhost"]);
  if (deployCode !== 0) {
    console.error("[dev] Deployment failed — see the error above.");
    return stop(deployCode);
  }

  if (SEED) {
    tag("Adding demo listings…");
    const seedCode = await runToEnd(["run", "scripts/seed-demo.js", "--network", "localhost"]);
    if (seedCode !== 0) console.error("[dev] Seeding failed (the platform itself is deployed and fine).");
  }

  chainReady = true; // from now on, mined transactions are summarised in this window
  printReady();

  if (!ownNode) return process.exit(0); // we don't own that chain; nothing to keep alive
  // otherwise: stay alive; the chain child process keeps the event loop running.
}

main().catch((err) => {
  console.error(err);
  stop(1);
});
