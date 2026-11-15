/**
 * deploy.js — Full platform deploy script
 *
 * Deploys all four contracts in the correct order, wires them together, and
 * then hands the results to the web app so nobody has to copy addresses or
 * ABIs around by hand.
 *
 * Dependency chain:
 *   BarterToken
 *       ↓  (address)
 *   Escrow  ─────────────────────────────────────────────┐
 *       ↓  (address)                                     │
 *   BarterAgreement  ────────────────────────────────────┤
 *       ↓  (address)                                     │
 *   Reputation  ───────────────────────────────────────┐  │
 *                                                       │  │
 * Wire-up calls after deploy:                          │  │
 *   escrow.setBarterAgreement(barterAgreementAddress) ─┼──┘
 *   barterAgreement.setReputation(reputationAddress) ──┘
 *   barterToken.addMinter(reputationAddress)
 *     → Reputation can now mint the trade bonuses
 *
 * What gets written for the other parts of the project:
 *   Blockchain/deployments.json                       (all addresses + chain id)
 *   Frontend/src/blockchain/deployed.json             (addresses per chain, used by networks.js)
 *   Frontend/src/blockchain/abi/*.json                (fresh ABIs from the compile)
 *   backend_test/src/chain/abi.json + deployed.json   (so the API can verify on-chain data)
 *
 * Usage (local development):
 *   Terminal 1:  npx hardhat node
 *   Terminal 2:  npx hardhat run scripts/deploy.js --network localhost
 *
 * The deployer (Hardhat account #0 locally) becomes the platform ADMIN — the
 * only wallet that can rule on disputes.
 */

const { ethers, network, artifacts } = require("hardhat");
const fs   = require("fs");
const path = require("path");

const STEP  = (n, label) => console.log(`\nStep ${n}/6  ${label}`);
const DONE  = (label)    => console.log(`          ✓ ${label}`);
const INFO  = (k, v)     => console.log(`          ${k.padEnd(36)}: ${v}`);
const LINE  = ()         => console.log("──────────────────────────────────────────────");

const CONTRACT_NAMES = ["BarterToken", "Escrow", "BarterAgreement", "Reputation"];

/** Reads a JSON file if it exists, otherwise returns `fallback`. */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Copies ABIs + addresses into the frontend and backend folders, if they sit
 * next to this Blockchain folder. Silently skipped when they don't (e.g. the
 * contracts are deployed from a stand-alone checkout).
 */
async function syncToApps({ chainIdHex, networkName, addresses }) {
  const repoRoot    = path.join(__dirname, "..", "..");
  const frontendDir = path.join(repoRoot, "Frontend", "src", "blockchain");
  const backendDir  = path.join(repoRoot, "backend_test", "src", "chain");

  if (fs.existsSync(path.join(repoRoot, "Frontend", "src"))) {
    for (const name of CONTRACT_NAMES) {
      const { abi } = await artifacts.readArtifact(name);
      writeJson(path.join(frontendDir, "abi", `${name}.json`), abi);
    }
    const deployedFile = path.join(frontendDir, "deployed.json");
    const deployed = readJson(deployedFile, {});
    deployed[chainIdHex] = { name: networkName, contracts: addresses };
    writeJson(deployedFile, deployed);
    DONE(`Frontend synced  (${path.relative(repoRoot, frontendDir)})`);
  } else {
    INFO("Frontend", "folder not found — skipped (copy ABIs/addresses manually)");
  }

  if (fs.existsSync(path.join(repoRoot, "backend_test", "src"))) {
    const { abi } = await artifacts.readArtifact("BarterAgreement");
    writeJson(path.join(backendDir, "abi.json"), abi);
    writeJson(path.join(backendDir, "deployed.json"), {
      chainId: chainIdHex,
      network: networkName,
      BarterAgreement: addresses.BarterAgreement,
    });
    DONE(`Backend synced   (${path.relative(repoRoot, backendDir)})`);
  } else {
    INFO("Backend", "folder not found — skipped");
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance    = await ethers.provider.getBalance(deployer.address);
  const chainId    = (await ethers.provider.getNetwork()).chainId;
  const chainIdHex = "0x" + chainId.toString(16);

  console.log("══════════════════════════════════════════════");
  console.log("  Decentralized Barter Platform — Full Deploy");
  console.log("══════════════════════════════════════════════");
  INFO("Network",  network.name);
  INFO("Chain ID", `${chainId} (${chainIdHex})`);
  INFO("Deployer / admin", deployer.address);
  INFO("Balance",  ethers.formatEther(balance) + " ETH");
  LINE();

  // ── 1. BarterToken ──────────────────────────────────────────────────────────
  STEP(1, "Deploying BarterToken...");
  const BarterToken = await ethers.getContractFactory("BarterToken");
  const barterToken = await BarterToken.deploy(deployer.address);
  await barterToken.waitForDeployment();
  const tokenAddress = await barterToken.getAddress();

  INFO("Address",         tokenAddress);
  INFO("Initial supply",  ethers.formatEther(await barterToken.totalSupply()) + " BTK");
  INFO("Max supply",      ethers.formatEther(await barterToken.MAX_SUPPLY())  + " BTK");
  INFO("Starter grant",   ethers.formatEther(await barterToken.STARTER_TOKENS()) + " BTK per wallet");
  DONE("BarterToken deployed");

  // ── 2. Escrow ───────────────────────────────────────────────────────────────
  STEP(2, "Deploying Escrow...");
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(tokenAddress, deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  INFO("Address", escrowAddress);
  DONE("Escrow deployed (holds the ETH + X BTK of both parties on every trade)");

  // ── 3. BarterAgreement ──────────────────────────────────────────────────────
  STEP(3, "Deploying BarterAgreement...");
  const BarterAgreement = await ethers.getContractFactory("BarterAgreement");
  const barterAgreement = await BarterAgreement.deploy(
    tokenAddress, escrowAddress, deployer.address
  );
  await barterAgreement.waitForDeployment();
  const agreementAddress = await barterAgreement.getAddress();

  INFO("Address",             agreementAddress);
  INFO("Min lock amount (X)", ethers.formatEther(await barterAgreement.minimumLockAmount()) + " BTK");
  INFO("Bonus per star",      `${await barterAgreement.BONUS_PERCENT()}% of X`);
  INFO("Rating window",       `${Number(await barterAgreement.ratingWindow()) / 3600} hours`);
  DONE("BarterAgreement deployed");

  // ── 4. Reputation ───────────────────────────────────────────────────────────
  STEP(4, "Deploying Reputation...");
  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await Reputation.deploy(tokenAddress, agreementAddress, deployer.address);
  await reputation.waitForDeployment();
  const reputationAddress = await reputation.getAddress();

  INFO("Address",          reputationAddress);
  INFO("BarterAgreement",  await reputation.barterAgreement());
  DONE("Reputation deployed (ledger + the only minter of trade bonuses)");

  // ── 5. Wire-up ─────────────────────────────────────────────────────────────
  STEP(5, "Wiring contracts...");

  const tx1 = await escrow.setBarterAgreement(agreementAddress);
  await tx1.wait();
  const ok1 = (await escrow.barterAgreement()) === agreementAddress;
  INFO("escrow.setBarterAgreement", ok1 ? "✓" : "✗");

  const tx2 = await barterAgreement.setReputation(reputationAddress);
  await tx2.wait();
  const ok2 = (await barterAgreement.reputation()) === reputationAddress;
  INFO("agreement.setReputation", ok2 ? "✓" : "✗");

  const tx3 = await barterToken.addMinter(reputationAddress);
  await tx3.wait();
  const ok3 = await barterToken.isMinter(reputationAddress);
  INFO("barterToken.addMinter(reputation)", ok3 ? "✓" : "✗");

  if (!(ok1 && ok2 && ok3)) {
    throw new Error("Wiring verification failed — do not use this deployment.");
  }
  DONE("All contracts wired and verified");

  // ── 6. Save and hand off to the apps ───────────────────────────────────────
  STEP(6, "Saving deployment info...");

  const addresses = {
    BarterToken    : tokenAddress,
    Escrow         : escrowAddress,
    BarterAgreement: agreementAddress,
    Reputation     : reputationAddress,
  };

  const deployment = {
    network   : network.name,
    chainId   : chainId.toString(),
    deployer  : deployer.address,
    timestamp : new Date().toISOString(),
    contracts : addresses,
  };

  writeJson(path.join(__dirname, "..", "deployments.json"), deployment);
  DONE("deployments.json saved");

  await syncToApps({ chainIdHex, networkName: network.name, addresses });

  console.log("\n══════════════════════════════════════════════");
  console.log("  Deployment complete — all 4 contracts live");
  console.log("══════════════════════════════════════════════");
  for (const [name, addr] of Object.entries(addresses)) INFO(name, addr);
  console.log("══════════════════════════════════════════════");

  console.log("\nThe backend reads the BarterAgreement address from backend_test/src/chain/deployed.json");
  console.log("automatically. Only if your node is NOT at http://127.0.0.1:8545 add to backend_test/.env:");
  console.log("  CHAIN_RPC_URL=<your node url>");

  console.log("\nNext steps:");
  console.log("  • Import Hardhat account #0 (the admin) and a couple of others into MetaMask,");
  console.log("    (the admin only rules on disputes — it cannot list, trade or hold a reputation),");
  console.log("    on network 'Hardhat Localhost' (RPC http://127.0.0.1:8545, chain id 31337).");
  console.log("  • Each wallet claims its 100 BTK from the Tokens page before it can trade.");
  console.log("  • Only the admin wallet sees the Admin page (open disputes + the history of past ones).");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
