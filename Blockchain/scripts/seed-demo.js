/**
 * seed-demo.js — fills a FRESH local chain with a few demo listings and one
 * pending trade request, so the marketplace isn't empty when you present.
 *
 * Everything goes through the real contracts (it is just three wallets using
 * the dApp), so what you see in the app afterwards is genuine on-chain data.
 *
 *   Terminal 1:  npm run node
 *   Terminal 2:  npm run deploy:local
 *                npm run seed:demo
 *
 * Uses Hardhat accounts #1, #2 and #3 (account #0 stays the clean admin).
 * Run it ONCE per fresh chain — running it again simply adds duplicates.
 * A SELL listing must carry a photo fingerprint, so the demo textbook uses a placeholder one
 * (there is no image behind it — the app just shows "no photo"). Add real photos in the app.
 *
 * The admin (account #0) is deliberately NOT used: it cannot list or trade.
 */

const { ethers } = require("hardhat");
const fs   = require("fs");
const path = require("path");

const BTK = (n) => ethers.parseUnits(String(n), 18);

async function main() {
  const file = path.join(__dirname, "..", "deployments.json");
  if (!fs.existsSync(file)) {
    throw new Error("deployments.json not found — run `npm run deploy:local` first.");
  }
  const { contracts } = JSON.parse(fs.readFileSync(file, "utf8"));

  const signers = await ethers.getSigners();
  const [, alice, bob, carol] = signers;

  const code = await ethers.provider.getCode(contracts.BarterAgreement);
  if (code === "0x") {
    throw new Error("No contract at the saved address — the node was restarted. Run `npm run deploy:local` again.");
  }

  const token     = await ethers.getContractAt("BarterToken",     contracts.BarterToken);
  const agreement = await ethers.getContractAt("BarterAgreement", contracts.BarterAgreement);

  const T = { BARTER: 0, SELL: 1, BUY: 2 };

  console.log("Claiming starter BTK for the demo wallets…");
  for (const s of [alice, bob, carol]) {
    if (!(await token.hasClaimedStarterTokens(s.address))) {
      await (await token.connect(s).claimStarterTokens()).wait();
    }
    console.log(`  ${s.address}  ${ethers.formatUnits(await token.balanceOf(s.address), 18)} BTK`);
  }

  console.log("\nCreating listings…");
  const make = async (signer, ...args) => {
    const tx = await agreement.connect(signer).createListing(...args);
    await tx.wait();
    return (await agreement.nextListingId()) - 1n;
  };

  // A SELL listing needs a photo fingerprint (SHA-256 of the image) — this one is a placeholder.
  const PLACEHOLDER_PHOTO = ethers.sha256(ethers.toUtf8Bytes("demo-textbook-photo"));

  // Y is the ETH side of every listing: the price on SELL / BUY, and the ETH deposit EACH side locks on a BARTER.
  //            type          item                                  category       description                                                  wants                        photo              Y (ETH)                     X (BTK)
  const l1 = await make(alice, T.BARTER, "Mechanical keyboard",               "Electronics", "Tenkeyless, brown switches, barely used.",            "Desk lamp or monitor arm", "",                ethers.parseEther("0.02"), BTK(10));
  const l2 = await make(bob,   T.SELL,   "Engineering Mathematics textbook",  "Books",       "Latest edition, clean pages, no highlighting.",       "",                         PLACEHOLDER_PHOTO, ethers.parseEther("0.05"), BTK(10));
  const l3 = await make(carol, T.BUY,    "Used scientific calculator",        "Electronics", "Looking for a Casio fx-991 in working condition.",    "",                         "",                ethers.parseEther("0.02"), BTK(5));
  console.log(`  #${l1} Barter · #${l2} Sell · #${l3} Buy`);

  console.log("\nBob requests Alice's keyboard swap (his 10 BTK and 0.02 ETH are locked in escrow)…");
  await (await token.connect(bob).approve(contracts.Escrow, BTK(10))).wait();
  await (await agreement.connect(bob).requestTrade(
    l1, "Desk lamp", "Adjustable LED lamp, works perfectly.", "", { value: ethers.parseEther("0.02") }
  )).wait();

  console.log("\nDone. In the app:");
  console.log("  • Alice (account #1) has a pending request to accept or reject → Trades page.");
  console.log("  • Bob (#2) sells a textbook, Carol (#3) wants a calculator → try requesting them.");
  console.log("  • Account #0 is the admin: it rules on disputes and cannot list or trade.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
