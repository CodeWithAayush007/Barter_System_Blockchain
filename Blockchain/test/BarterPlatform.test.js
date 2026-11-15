/**
 * BarterPlatform.test.js
 *
 * Full-stack test suite for the four platform contracts, exercised together
 * the way BarterAgreement actually wires them: BarterToken + Escrow +
 * BarterAgreement + Reputation.
 *
 * It pins down the three rule sets of the project's workflow diagrams:
 *
 *   BARTER  (BTK & ETH TRADE WORKFLOW)   both sides lock X BTK + Y ETH
 *   SELL    (SELL OPTION WORKFLOW)       seller locks X BTK; buyer locks X BTK + Y ETH
 *   BUY     (BUY OPTION WORKFLOW)        seller locks X BTK; buyer locks X BTK + Y ETH
 *
 *   No dispute      each side gets X back + 5% of X per star the OTHER side gave;
 *                   BARTER: each side's Y ETH comes back; SELL/BUY: the seller is paid Y ETH.
 *   BARTER dispute  claimant right  -> X + 5%X*5 BTK and ALL the ETH (2Y); the other side loses its X
 *                   claimant lying  -> the other side gets X + 5%X*5 + its Y; the claimant X + Y
 *   SELL/BUY dispute (the admin picks one of three, whoever raised it)
 *       SELLER_WINS         seller: Y ETH + X + 5%X*5      buyer: X
 *       BUYER (missing)     buyer : Y ETH + X              seller: 70% of X (30% burned)
 *       BUYER (not as desc) buyer returns the item first, then:
 *                           buyer : Y ETH + X + 5%X*5      seller: 85% of X (15% burned)
 *
 * plus: request photos, calling a trade off by agreement, shipping, an admin who
 * cannot trade and keeps a dispute history.
 *
 * Run with:  npx hardhat test
 */

const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers, network } = require("hardhat");

const eth = (n) => ethers.parseEther(String(n));
const btk = (n) => ethers.parseUnits(String(n), 18);

// Listing types, must match the ListingType enum order in BarterAgreement.sol
const BARTER = 0, SELL = 1, BUY = 2;
// Trade statuses, must match the TradeStatus enum order in BarterAgreement.sol
const PENDING = 0, IN_ESCROW = 1, AWAITING_RATINGS = 2, COMPLETED = 3, REJECTED = 4, CANCELLED = 5,
      DISPUTED = 6, RESOLVED = 7, RETURN_PENDING = 8, CANCELLED_IN_ESCROW = 9;
// Dispute kinds and rulings, must match the enums in BarterAgreement.sol
const NOT_RECEIVED = 0, NOT_AS_DESCRIBED = 1, NOT_CONFIRMED = 2;
const CLAIMANT_RIGHT = 1, CLAIMANT_LYING = 2, SELLER_WINS = 3, BUYER_WINS_MISSING = 4, BUYER_WINS_NOT_AS_DESCRIBED = 5;
const RET_NONE = 0, RET_SELLER = 1, RET_ADMIN = 2, RET_NOT_RETURNED = 3;
// Escrow statuses, must match Escrow.Status
const ESC_AWAITING = 1, ESC_ACTIVE = 2, ESC_ETH_SETTLED = 3, ESC_RELEASED = 4, ESC_REFUNDED = 5;

// X (BTK lock) used throughout — a round number so every bonus is easy to read:
//   5% of 100 BTK = 5 BTK per star  (1★ = 5, 2★ = 10, 3★ = 15, 4★ = 20, 5★ = 25)
const X = btk(100);
const PER_STAR = btk(5);
const BONUS5 = btk(25);
const Y = eth("0.2");        // the ETH deposit each side locks on a BARTER listing
const PRICE = eth("0.5");    // the price on a SELL / BUY listing
const PHOTO = "0x" + "ab".repeat(32);   // a SHA-256 fingerprint, as the app would send it
const PHOTO2 = "0x" + "cd".repeat(32);

/** Deploys and wires all four contracts; gives alice, bob, carol and dave 1000 BTK each. */
async function deployPlatformFixture() {
  const [deployer, alice, bob, carol, dave, eve] = await ethers.getSigners();

  const BarterToken = await ethers.getContractFactory("BarterToken");
  const token = await BarterToken.deploy(deployer.address);

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(await token.getAddress(), deployer.address);

  const BarterAgreement = await ethers.getContractFactory("BarterAgreement");
  const agreement = await BarterAgreement.deploy(
    await token.getAddress(), await escrow.getAddress(), deployer.address
  );

  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await Reputation.deploy(
    await token.getAddress(), await agreement.getAddress(), deployer.address
  );

  await escrow.setBarterAgreement(await agreement.getAddress());
  await agreement.setReputation(await reputation.getAddress());
  await token.addMinter(await reputation.getAddress());

  // 100 starter BTK (claimed) + 900 from the deployer = 1000 BTK each.
  for (const user of [alice, bob, carol, dave]) {
    await token.connect(user).claimStarterTokens();
    await token.transfer(user.address, btk(900));
  }

  const escrowAddress = await escrow.getAddress();

  // ---- reads (the wide structs are only exposed through the batch getters) --
  const L = async (id) => (await agreement.getListingsBatch([id]))[0];
  const R = async (id) => (await agreement.getRequestsBatch([id]))[0];
  const D = async (id) => (await agreement.getDisputesBatch([id]))[0];

  /** Approves the escrow for `amount` BTK on behalf of `user`. */
  async function approveEscrow(user, amount) {
    await token.connect(user).approve(escrowAddress, amount);
  }

  // ---- scenario helpers -----------------------------------------------------

  async function listBarter(owner, { lock = X, eth: y = Y, image = "" } = {}) {
    await agreement.connect(owner).createListing(
      BARTER, "Mechanical Keyboard", "Electronics", "75% hotswap board",
      "Studio Headphones", image, y, lock
    );
    return agreement.totalListings();
  }

  async function listSell(owner, { price = PRICE, lock = X, image = PHOTO } = {}) {
    await agreement.connect(owner).createListing(
      SELL, "Vintage Camera", "Electronics", "Fully serviced 35mm SLR", "", image, price, lock
    );
    return agreement.totalListings();
  }

  async function listBuy(owner, { price = PRICE, lock = X, image = "" } = {}) {
    await agreement.connect(owner).createListing(
      BUY, "Wanted: Turntable", "Electronics", "Looking for a working turntable", "", image, price, lock
    );
    return agreement.totalListings();
  }

  /** Requester approves X and requests the trade (attaching whatever ETH the listing needs). */
  async function request(user, listingId, offered = "Studio Headphones", image = "") {
    const lock = (await L(listingId)).lockAmount;
    const value = await agreement.requesterEthRequired(listingId);
    await approveEscrow(user, lock);
    await agreement.connect(user).requestTrade(listingId, offered, "Barely used", image, { value });
    return agreement.totalRequests();
  }

  /** Owner approves X and accepts the request (attaching whatever ETH the listing needs). */
  async function accept(owner, requestId) {
    const req = await R(requestId);
    const value = await agreement.ownerEthRequired(req.listingId);
    await approveEscrow(owner, req.lockAmount);
    await agreement.connect(owner).acceptTradeRequest(requestId, { value });
  }

  /** List -> request -> accept. Returns { listingId, requestId, buyer, seller } (buyer/seller null for barter). */
  async function openTrade(kind, owner, requester, opts = {}) {
    let listingId;
    if (kind === "barter") listingId = await listBarter(owner, opts);
    else if (kind === "sell") listingId = await listSell(owner, opts);
    else listingId = await listBuy(owner, opts);
    const requestId = await request(requester, listingId);
    await accept(owner, requestId);
    const buyer = kind === "sell" ? requester : kind === "buy" ? owner : null;
    const seller = kind === "sell" ? owner : kind === "buy" ? requester : null;
    return { listingId, requestId, buyer, seller };
  }

  /** BARTER: both parties confirm the swap happened. */
  async function confirmBoth(owner, requester, requestId) {
    await agreement.connect(owner).confirmTradeCompletion(requestId);
    await agreement.connect(requester).confirmTradeCompletion(requestId);
  }

  /** SELL/BUY: the seller ships and the buyer confirms receipt. */
  async function shipAndConfirm(seller, buyer, requestId) {
    await agreement.connect(seller).markShipped(requestId, "TRACK-123");
    await agreement.connect(buyer).confirmTradeCompletion(requestId);
  }

  return {
    deployer, alice, bob, carol, dave, eve, token, escrow, agreement, reputation, escrowAddress,
    L, R, D, approveEscrow, listBarter, listSell, listBuy, request, accept, openTrade, confirmBoth, shipAndConfirm,
  };
}

/** Escrow must be completely empty (BTK and ETH) once a trade has settled. */
async function expectEscrowEmpty(token, escrow) {
  const addr = await escrow.getAddress();
  expect(await token.balanceOf(addr)).to.equal(0n);
  expect(await ethers.provider.getBalance(addr)).to.equal(0n);
}

// =============================================================================
// BarterToken
// =============================================================================

describe("BarterToken", function () {
  it("mints the deployer's initial supply and enforces the max supply cap", async function () {
    const { token, deployer } = await loadFixture(deployPlatformFixture);
    // deployer sent 3600 BTK to the four test users in the fixture
    expect(await token.balanceOf(deployer.address)).to.equal((await token.INITIAL_SUPPLY()) - btk(3600));
    expect(await token.MAX_SUPPLY()).to.equal(btk(100_000_000));
  });

  it("lets each wallet claim its 100 BTK starter grant exactly once", async function () {
    const { token, alice } = await loadFixture(deployPlatformFixture);
    expect(await token.hasClaimedStarterTokens(alice.address)).to.equal(true);
    await expect(token.connect(alice).claimStarterTokens())
      .to.be.revertedWith("BarterToken: starter tokens already claimed");
  });

  it("only lets addresses with MINTER_ROLE mint", async function () {
    const { token, alice, bob } = await loadFixture(deployPlatformFixture);
    await expect(token.connect(alice).mint(bob.address, btk(1))).to.be.reverted;
  });
});

// =============================================================================
// Listings — barter / sell / buy only
// =============================================================================

describe("BarterAgreement — listings", function () {
  it("stores the owner-chosen X (BTK) and Y (ETH) on the listing", async function () {
    const { alice, listBarter, L } = await loadFixture(deployPlatformFixture);
    const id = await listBarter(alice, { lock: btk(42), eth: eth("0.07") });
    const listing = await L(id);
    expect(listing.lockAmount).to.equal(btk(42));
    expect(listing.price).to.equal(eth("0.07"));
    expect(listing.owner).to.equal(alice.address);
    expect(listing.active).to.equal(true);
  });

  it("emits ListingCreated carrying the ETH amount and the lock amount", async function () {
    const { agreement, alice } = await loadFixture(deployPlatformFixture);
    await expect(
      agreement.connect(alice).createListing(BARTER, "Keyboard", "Electronics", "Desc", "Headphones", "", Y, X)
    ).to.emit(agreement, "ListingCreated")
      .withArgs(1, alice.address, BARTER, "Keyboard", "Headphones", "Electronics", Y, X, anyValue);
  });

  it("rejects a lock amount below the minimum (1 BTK)", async function () {
    const { agreement, alice } = await loadFixture(deployPlatformFixture);
    await expect(
      agreement.connect(alice).createListing(BARTER, "Item", "Cat", "Desc", "Wanted", "", Y, btk(1) - 1n)
    ).to.be.revertedWith("lock amount below minimum");
    await expect(
      agreement.connect(alice).createListing(BARTER, "Item", "Cat", "Desc", "Wanted", "", Y, btk(1))
    ).to.not.be.reverted;
  });

  it("requires an ETH amount on EVERY listing type — barter now locks ETH too", async function () {
    const { agreement, alice } = await loadFixture(deployPlatformFixture);
    await expect(agreement.connect(alice).createListing(BARTER, "Item", "Cat", "Desc", "Wanted", "", 0, X))
      .to.be.revertedWith("ETH amount required");
    await expect(agreement.connect(alice).createListing(SELL, "Item", "Cat", "Desc", "", PHOTO, 0, X))
      .to.be.revertedWith("ETH amount required");
    await expect(agreement.connect(alice).createListing(BUY, "Item", "Cat", "Desc", "", "", 0, X))
      .to.be.revertedWith("ETH amount required");
  });

  it("requires a wanted item on BARTER listings", async function () {
    const { agreement, alice } = await loadFixture(deployPlatformFixture);
    await expect(agreement.connect(alice).createListing(BARTER, "Item", "Cat", "Desc", "", "", Y, X))
      .to.be.revertedWith("wanted item required for barter");
  });

  it("requires a photo on SELL listings; BARTER and BUY photos are optional", async function () {
    const { agreement, alice } = await loadFixture(deployPlatformFixture);
    await expect(agreement.connect(alice).createListing(SELL, "Camera", "Cat", "Desc", "", "", PRICE, X))
      .to.be.revertedWith("photo required for sell listing");
    await expect(agreement.connect(alice).createListing(SELL, "Camera", "Cat", "Desc", "", PHOTO, PRICE, X)).to.not.be.reverted;
    await expect(agreement.connect(alice).createListing(BUY, "Camera", "Cat", "Desc", "", "", PRICE, X)).to.not.be.reverted;
    await expect(agreement.connect(alice).createListing(BARTER, "Camera", "Cat", "Desc", "Lens", "", Y, X)).to.not.be.reverted;
  });

  it("refuses an absurdly long photo fingerprint", async function () {
    const { agreement, alice } = await loadFixture(deployPlatformFixture);
    await expect(agreement.connect(alice).createListing(BUY, "Item", "Cat", "Desc", "", "x".repeat(101), PRICE, X))
      .to.be.revertedWith("image hash too long");
  });

  it("has no ARTIFACT type — the only valid listing types are BARTER (0), SELL (1) and BUY (2)", async function () {
    const { agreement, alice } = await loadFixture(deployPlatformFixture);
    await expect(
      agreement.connect(alice).createListing(3, "Item", "Cat", "Desc", "Wanted", "", Y, X)
    ).to.be.reverted; // enum out of range is rejected at the ABI level
  });

  it("lets an owner deactivate a listing but not while a trade is active", async function () {
    const { agreement, alice, bob, listBarter, request, accept, L } = await loadFixture(deployPlatformFixture);
    const listingId = await listBarter(alice);
    const requestId = await request(bob, listingId);
    await accept(alice, requestId);
    await expect(agreement.connect(alice).deactivateListing(listingId)).to.be.revertedWith("active trade in progress");

    const other = await listBarter(alice);
    await expect(agreement.connect(bob).deactivateListing(other)).to.be.revertedWith("not listing owner");
    await expect(agreement.connect(alice).deactivateListing(other)).to.emit(agreement, "ListingDeactivated");
    expect((await L(other)).active).to.equal(false);
  });
});

// =============================================================================
// Locking — what each side puts in escrow
// =============================================================================

describe("BarterAgreement — what gets locked", function () {
  it("BARTER: BOTH sides lock X BTK + Y ETH (requester at request, owner at accept)", async function () {
    const { agreement, token, escrow, escrowAddress, alice, bob, listBarter, approveEscrow, R } =
      await loadFixture(deployPlatformFixture);
    const listingId = await listBarter(alice);
    expect(await agreement.requesterEthRequired(listingId)).to.equal(Y);
    expect(await agreement.ownerEthRequired(listingId)).to.equal(Y);

    await approveEscrow(bob, X);
    await expect(agreement.connect(bob).requestTrade(listingId, "Headphones", "Used", "", { value: Y }))
      .to.changeTokenBalances(token, [bob, escrow], [-X, X]);
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(Y);
    expect(await escrow.getStatus(await agreement.requestEscrowId(1))).to.equal(ESC_AWAITING);

    await approveEscrow(alice, X);
    await expect(agreement.connect(alice).acceptTradeRequest(1, { value: Y }))
      .to.changeTokenBalances(token, [alice, escrow], [-X, X]);
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(Y * 2n);
    expect(await token.balanceOf(escrowAddress)).to.equal(X * 2n);
    expect(await escrow.getStatus(await agreement.requestEscrowId(1))).to.equal(ESC_ACTIVE);

    const req = await R(1);
    expect(req.requesterEthLocked).to.equal(Y);
    expect(req.ownerEthLocked).to.equal(Y);
    expect(req.status).to.equal(IN_ESCROW);
  });

  it("SELL: the buyer (requester) locks X + Y ETH; the seller (owner) locks only X", async function () {
    const { agreement, token, escrow, escrowAddress, alice, bob, listSell, approveEscrow } =
      await loadFixture(deployPlatformFixture);
    const listingId = await listSell(alice);
    expect(await agreement.requesterEthRequired(listingId)).to.equal(PRICE);
    expect(await agreement.ownerEthRequired(listingId)).to.equal(0n);

    await approveEscrow(bob, X);
    await expect(agreement.connect(bob).requestTrade(listingId, "", "", "", { value: PRICE }))
      .to.changeTokenBalances(token, [bob, escrow], [-X, X]);
    await approveEscrow(alice, X);
    await agreement.connect(alice).acceptTradeRequest(1, { value: 0 });

    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(PRICE);
    expect(await token.balanceOf(escrowAddress)).to.equal(X * 2n);
  });

  it("BUY: the seller (requester) locks only X; the buyer (owner) locks X + Y ETH when accepting", async function () {
    const { agreement, token, escrow, escrowAddress, alice, bob, listBuy, approveEscrow } =
      await loadFixture(deployPlatformFixture);
    const listingId = await listBuy(alice);
    expect(await agreement.requesterEthRequired(listingId)).to.equal(0n);
    expect(await agreement.ownerEthRequired(listingId)).to.equal(PRICE);

    await approveEscrow(bob, X);
    await agreement.connect(bob).requestTrade(listingId, "Technics SL-1200", "Mint", "", { value: 0 });
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(0n);

    await approveEscrow(alice, X);
    await expect(agreement.connect(alice).acceptTradeRequest(1, { value: PRICE }))
      .to.changeTokenBalances(token, [alice, escrow], [-X, X]);
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(PRICE);
    expect(await token.balanceOf(escrowAddress)).to.equal(X * 2n);
  });

  it("enforces the EXACT ETH on every type, on both the request and the accept", async function () {
    const { agreement, alice, bob, carol, listBarter, listSell, listBuy, approveEscrow, request } =
      await loadFixture(deployPlatformFixture);

    const barter = await listBarter(alice);
    await approveEscrow(bob, X);
    await expect(agreement.connect(bob).requestTrade(barter, "Headphones", "", "", { value: 0 }))
      .to.be.revertedWith("incorrect ETH amount sent");
    await expect(agreement.connect(bob).requestTrade(barter, "Headphones", "", "", { value: Y + 1n }))
      .to.be.revertedWith("incorrect ETH amount sent");
    const bReq = await request(bob, barter);
    await approveEscrow(alice, X);
    await expect(agreement.connect(alice).acceptTradeRequest(bReq, { value: 0 }))
      .to.be.revertedWith("incorrect ETH amount sent");

    const sell = await listSell(alice);
    await approveEscrow(carol, X);
    await expect(agreement.connect(carol).requestTrade(sell, "", "", "", { value: PRICE - 1n }))
      .to.be.revertedWith("incorrect ETH amount sent");

    const buy = await listBuy(carol);
    await approveEscrow(bob, X);
    await expect(agreement.connect(bob).requestTrade(buy, "Turntable", "", "", { value: 1 }))
      .to.be.revertedWith("incorrect ETH amount sent");
    const buyReq = await request(bob, buy, "Turntable");
    await approveEscrow(carol, X);
    await expect(agreement.connect(carol).acceptTradeRequest(buyReq, { value: 0 }))
      .to.be.revertedWith("incorrect ETH amount sent");
  });

  it("will not let a requester trade without approving the Escrow for X", async function () {
    const { agreement, alice, bob, listBarter } = await loadFixture(deployPlatformFixture);
    const listingId = await listBarter(alice);
    await expect(agreement.connect(bob).requestTrade(listingId, "Headphones", "", "", { value: Y })).to.be.reverted;
  });

  it("will not let the owner accept without approving the Escrow for X", async function () {
    const { agreement, alice, bob, listBarter, request } = await loadFixture(deployPlatformFixture);
    const requestId = await request(bob, await listBarter(alice));
    await expect(agreement.connect(alice).acceptTradeRequest(requestId, { value: Y })).to.be.reverted;
  });

  it("requires an offered item for BARTER and BUY, but not for SELL", async function () {
    const { agreement, alice, bob, listBarter, listSell, listBuy, approveEscrow } = await loadFixture(deployPlatformFixture);
    await approveEscrow(bob, X * 3n);
    await expect(agreement.connect(bob).requestTrade(await listBarter(alice), "", "", "", { value: Y }))
      .to.be.revertedWith("offered item required");
    await expect(agreement.connect(bob).requestTrade(await listBuy(alice), "", "", "", { value: 0 }))
      .to.be.revertedWith("offered item required");
    await expect(agreement.connect(bob).requestTrade(await listSell(alice), "", "", "", { value: PRICE })).to.not.be.reverted;
  });

  it("blocks self-trades and duplicate pending requests", async function () {
    const { agreement, alice, bob, listBarter, approveEscrow } = await loadFixture(deployPlatformFixture);
    const listingId = await listBarter(alice);
    await approveEscrow(alice, X);
    await expect(agreement.connect(alice).requestTrade(listingId, "Mine", "", "", { value: Y }))
      .to.be.revertedWith("cannot trade with yourself");

    await approveEscrow(bob, X * 2n);
    await agreement.connect(bob).requestTrade(listingId, "Headphones", "", "", { value: Y });
    await expect(agreement.connect(bob).requestTrade(listingId, "Headphones again", "", "", { value: Y }))
      .to.be.revertedWith("duplicate pending request");
  });

  it("fully refunds a cancelled BARTER request — the BTK and the ETH", async function () {
    const { agreement, token, escrow, alice, bob, listBarter, request, R } = await loadFixture(deployPlatformFixture);
    const requestId = await request(bob, await listBarter(alice));
    expect(await token.balanceOf(bob.address)).to.equal(btk(900));

    await expect(agreement.connect(alice).cancelTradeRequest(requestId)).to.be.revertedWith("not the requester");
    const tx = agreement.connect(bob).cancelTradeRequest(requestId);
    await expect(tx).to.emit(agreement, "TradeRequestCancelled");
    await expect(tx).to.changeEtherBalances([bob, escrow], [Y, -Y]);
    expect(await token.balanceOf(bob.address)).to.equal(btk(1000));
    expect((await R(requestId)).status).to.equal(CANCELLED);
    await expectEscrowEmpty(token, escrow);
    await expect(agreement.connect(bob).cancelTradeRequest(requestId)).to.be.revertedWith("can only cancel pending requests");
  });

  it("refunds a rejected request (ETH included) and only lets the owner reject", async function () {
    const { agreement, token, escrow, alice, bob, listSell, request, R } = await loadFixture(deployPlatformFixture);
    const requestId = await request(bob, await listSell(alice), "");
    await expect(agreement.connect(bob).rejectTradeRequest(requestId)).to.be.revertedWith("not listing owner");
    await expect(agreement.connect(alice).rejectTradeRequest(requestId)).to.changeEtherBalances([bob], [PRICE]);
    expect(await token.balanceOf(bob.address)).to.equal(btk(1000));
    expect((await R(requestId)).status).to.equal(REJECTED);
    await expectEscrowEmpty(token, escrow);
  });

  it("auto-rejects and refunds competing pending requests when one is accepted", async function () {
    const { agreement, token, alice, bob, carol, dave, listBarter, request, accept, R } = await loadFixture(deployPlatformFixture);
    const listingId = await listBarter(alice);
    const rBob = await request(bob, listingId);
    const rCarol = await request(carol, listingId);
    const rDave = await request(dave, listingId);

    await accept(alice, rCarol);
    expect((await R(rCarol)).status).to.equal(IN_ESCROW);
    expect((await R(rBob)).status).to.equal(REJECTED);
    expect((await R(rDave)).status).to.equal(REJECTED);
    expect(await token.balanceOf(bob.address)).to.equal(btk(1000));
    expect(await token.balanceOf(dave.address)).to.equal(btk(1000));
    expect(await token.balanceOf(carol.address)).to.equal(btk(900));
    // only Carol's BTK and Y (plus Alice's) are still in escrow
    expect(await ethers.provider.getBalance(await agreement.escrow())).to.equal(Y * 2n);
  });

  it("indexes requests by requester, by listing owner and by listing", async function () {
    const { agreement, alice, bob, carol, listBarter, request } = await loadFixture(deployPlatformFixture);
    const listingId = await listBarter(alice);
    const r1 = await request(bob, listingId);
    const r2 = await request(carol, listingId);
    expect(await agreement.getUserRequests(bob.address)).to.deep.equal([r1]);
    expect(await agreement.getOwnerRequests(alice.address)).to.deep.equal([r1, r2]);
    expect(await agreement.getListingRequests(listingId)).to.deep.equal([r1, r2]);
    expect(await agreement.getUserListings(alice.address)).to.deep.equal([listingId]);
  });
});

// =============================================================================
// Photos on trade requests
// =============================================================================

describe("BarterAgreement — photo on a trade request", function () {
  it("stores the requester's photo fingerprint on the request so the owner can see what is offered", async function () {
    const { agreement, alice, bob, listBarter, request, R } = await loadFixture(deployPlatformFixture);
    const listingId = await listBarter(alice);
    const requestId = await request(bob, listingId, "Studio Headphones", PHOTO2);
    expect((await R(requestId)).imageHash).to.equal(PHOTO2);
    expect((await R(requestId)).offeredItem).to.equal("Studio Headphones");
  });

  it("the photo is optional on every listing type, and is kept after acceptance", async function () {
    const { alice, bob, carol, listBarter, listSell, listBuy, request, accept, R } = await loadFixture(deployPlatformFixture);
    const a = await request(bob, await listBarter(alice));
    expect((await R(a)).imageHash).to.equal("");
    const b = await request(bob, await listSell(alice), "", PHOTO);
    expect((await R(b)).imageHash).to.equal(PHOTO);
    const c = await request(carol, await listBuy(alice), "Turntable", PHOTO2);
    await accept(alice, c);
    expect((await R(c)).imageHash).to.equal(PHOTO2);
  });

  it("refuses an absurdly long photo fingerprint on a request", async function () {
    const { agreement, alice, bob, listBarter, approveEscrow } = await loadFixture(deployPlatformFixture);
    const listingId = await listBarter(alice);
    await approveEscrow(bob, X);
    await expect(agreement.connect(bob).requestTrade(listingId, "Headphones", "", "x".repeat(101), { value: Y }))
      .to.be.revertedWith("image hash too long");
  });
});

// =============================================================================
// BARTER — successful trade (no dispute)
// =============================================================================

describe("BARTER rules — successful trade (no dispute)", function () {
  it("needs BOTH confirmations; each side's Y ETH comes back at once, the BTK waits for ratings", async function () {
    const { agreement, token, escrow, escrowAddress, alice, bob, openTrade, R } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob);

    await agreement.connect(alice).confirmTradeCompletion(requestId);
    expect((await R(requestId)).status).to.equal(IN_ESCROW);                 // one confirmation is not enough
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(Y * 2n);
    await expect(agreement.connect(alice).confirmTradeCompletion(requestId)).to.be.revertedWith("owner already confirmed");

    const tx = agreement.connect(bob).confirmTradeCompletion(requestId);
    await expect(tx).to.emit(agreement, "ExchangeConfirmed");
    await expect(tx).to.changeEtherBalances([alice, bob, escrow], [Y, Y, -(Y * 2n)]);
    expect((await R(requestId)).status).to.equal(AWAITING_RATINGS);
    expect(await token.balanceOf(escrowAddress)).to.equal(X * 2n);            // BTK still locked
  });

  it("returns X to both and mints 5% of X per star the OTHER party gave", async function () {
    const { agreement, token, escrow, reputation, alice, bob, openTrade, confirmBoth, R } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob);
    await confirmBoth(alice, bob, requestId);

    await agreement.connect(bob).rateCounterparty(requestId, 4);     // Bob rates Alice 4★ -> Alice earns 20
    await expect(agreement.connect(alice).rateCounterparty(requestId, 5)) // Alice rates Bob 5★ -> Bob earns 25
      .to.emit(agreement, "TradeCompleted")
      .withArgs(requestId, 1, alice.address, bob.address, 4, 5, PER_STAR * 4n, PER_STAR * 5n, anyValue);

    expect(await token.balanceOf(alice.address)).to.equal(btk(1000) + btk(20));
    expect(await token.balanceOf(bob.address)).to.equal(btk(1000) + btk(25));
    expect((await R(requestId)).status).to.equal(COMPLETED);
    await expectEscrowEmpty(token, escrow);

    expect((await reputation.getReputation(alice.address)).completedTradeCount).to.equal(1n);
    expect((await reputation.getReputation(alice.address)).averageRating).to.equal(400n);
    expect((await reputation.getReputation(bob.address)).averageRating).to.equal(500n);
    expect((await reputation.getReputation(alice.address)).tokensEarned).to.equal(btk(20));
  });

  it("pays the right bonus for every star value from 1 to 5", async function () {
    const { agreement, alice, bob, openTrade, confirmBoth } = await loadFixture(deployPlatformFixture);
    for (let stars = 1; stars <= 5; stars++) {
      expect(await agreement.bonusFor(X, stars)).to.equal(PER_STAR * BigInt(stars));
    }
    await expect(agreement.bonusFor(X, 0)).to.be.revertedWith("rating must be 1-5");
    await expect(agreement.bonusFor(X, 6)).to.be.revertedWith("rating must be 1-5");
  });

  it("scales the bonus with the owner-chosen X (5% of X, not a fixed amount)", async function () {
    const { agreement, token, alice, bob, openTrade, confirmBoth } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob, { lock: btk(40) });
    await confirmBoth(alice, bob, requestId);
    await agreement.connect(alice).rateCounterparty(requestId, 5);   // Bob earns 5% of 40 x 5 = 10
    await agreement.connect(bob).rateCounterparty(requestId, 3);     // Alice earns 5% of 40 x 3 = 6
    expect(await token.balanceOf(bob.address)).to.equal(btk(1000) + btk(10));
    expect(await token.balanceOf(alice.address)).to.equal(btk(1000) + btk(6));
  });

  it("exposes the bonus formula and the penalty constants", async function () {
    const { agreement } = await loadFixture(deployPlatformFixture);
    expect(await agreement.BONUS_PERCENT()).to.equal(5n);
    expect(await agreement.MAX_STARS()).to.equal(5n);
    expect(await agreement.MISSING_PENALTY_PERCENT()).to.equal(30n);
    expect(await agreement.NOT_AS_DESCRIBED_PENALTY_PERCENT()).to.equal(15n);
  });
});

// =============================================================================
// SELL and BUY — shipping, confirmation, successful trade
// =============================================================================

describe("SELL / BUY rules — shipping and successful trade (no dispute)", function () {
  it("SELL: only the BUYER confirms; the seller is paid Y ETH at that moment; BTK waits for ratings", async function () {
    const { agreement, token, escrow, escrowAddress, alice, bob, openTrade, R } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("sell", alice, bob);           // alice sells, bob buys

    await expect(agreement.connect(alice).confirmTradeCompletion(requestId))
      .to.be.revertedWith("only the buyer confirms receipt");

    const tx = agreement.connect(bob).confirmTradeCompletion(requestId);
    await expect(tx).to.emit(agreement, "ExchangeConfirmed");
    await expect(tx).to.changeEtherBalances([alice, bob, escrow], [PRICE, 0, -PRICE]);
    expect((await R(requestId)).status).to.equal(AWAITING_RATINGS);
    expect(await token.balanceOf(escrowAddress)).to.equal(X * 2n);
  });

  it("BUY: only the BUYER (the listing owner) confirms; the seller (the requester) is paid", async function () {
    const { agreement, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("buy", alice, bob);            // alice buys, bob sells

    await expect(agreement.connect(bob).confirmTradeCompletion(requestId))
      .to.be.revertedWith("only the buyer confirms receipt");
    const tx = agreement.connect(alice).confirmTradeCompletion(requestId);
    await expect(tx).to.changeEtherBalances([alice, bob], [0, PRICE]);
  });

  it("SELL ratings: seller gets Y ETH + X + 5% of X per star the buyer gave; buyer gets X + 5% per star the seller gave", async function () {
    const { agreement, token, escrow, alice, bob, openTrade, shipAndConfirm } = await loadFixture(deployPlatformFixture);
    const { requestId, buyer, seller } = await openTrade("sell", alice, bob);
    await shipAndConfirm(seller, buyer, requestId);

    await agreement.connect(buyer).rateCounterparty(requestId, 3);    // buyer rates the product/seller: seller earns 15
    await agreement.connect(seller).rateCounterparty(requestId, 5);   // seller rates the buyer: buyer earns 25

    expect(await token.balanceOf(seller.address)).to.equal(btk(1000) + btk(15));
    expect(await token.balanceOf(buyer.address)).to.equal(btk(1000) + btk(25));
    await expectEscrowEmpty(token, escrow);
  });

  it("BUY ratings work the same way with the roles swapped", async function () {
    const { agreement, token, escrow, alice, bob, openTrade, shipAndConfirm } = await loadFixture(deployPlatformFixture);
    const { requestId, buyer, seller } = await openTrade("buy", alice, bob);
    await shipAndConfirm(seller, buyer, requestId);
    await agreement.connect(buyer).rateCounterparty(requestId, 1);    // seller earns 5
    await agreement.connect(seller).rateCounterparty(requestId, 4);   // buyer earns 20
    expect(await token.balanceOf(seller.address)).to.equal(btk(1000) + btk(5));
    expect(await token.balanceOf(buyer.address)).to.equal(btk(1000) + btk(20));
    await expectEscrowEmpty(token, escrow);
  });

  it("the buyer can confirm even if the seller never pressed 'shipped' (in-person handover)", async function () {
    const { agreement, alice, bob, openTrade, R } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("sell", alice, bob);
    await agreement.connect(bob).confirmTradeCompletion(requestId);
    expect((await R(requestId)).status).to.equal(AWAITING_RATINGS);
  });

  it("only the seller can mark it shipped, once, in escrow, on a sell/buy trade — never on a barter", async function () {
    const { agreement, alice, bob, carol, openTrade, R } = await loadFixture(deployPlatformFixture);
    const sell = await openTrade("sell", alice, bob);

    await expect(agreement.connect(bob).markShipped(sell.requestId, "x")).to.be.revertedWith("only the seller can ship");
    await expect(agreement.connect(carol).markShipped(sell.requestId, "x")).to.be.revertedWith("not a trade party");
    await expect(agreement.connect(alice).markShipped(sell.requestId, "y".repeat(301))).to.be.revertedWith("note too long");

    await expect(agreement.connect(alice).markShipped(sell.requestId, "TRACK-9"))
      .to.emit(agreement, "TradeShipped").withArgs(sell.requestId, alice.address, "TRACK-9", anyValue);
    const req = await R(sell.requestId);
    expect(req.shipped).to.equal(true);
    expect(req.shippingNote).to.equal("TRACK-9");
    expect(req.shippedAt).to.be.gt(0n);
    await expect(agreement.connect(alice).markShipped(sell.requestId, "again")).to.be.revertedWith("already marked shipped");

    const barter = await openTrade("barter", carol, bob);
    await expect(agreement.connect(carol).markShipped(barter.requestId, "x")).to.be.revertedWith("only sell/buy trades ship");
  });

  it("cannot ship a trade that is not in escrow", async function () {
    const { agreement, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("sell", alice, bob);
    await agreement.connect(bob).confirmTradeCompletion(requestId);
    await expect(agreement.connect(alice).markShipped(requestId, "late")).to.be.revertedWith("trade not in escrow");
  });
});

// =============================================================================
// Ratings
// =============================================================================

describe("Ratings", function () {
  async function awaitingRatings() {
    const ctx = await loadFixture(deployPlatformFixture);
    const { alice, bob, openTrade, confirmBoth } = ctx;
    const { requestId } = await openTrade("barter", alice, bob);
    await confirmBoth(alice, bob, requestId);
    return { ...ctx, requestId };
  }

  it("only lets the two parties rate, once each, with 1-5 stars, and only after the exchange is confirmed", async function () {
    const { agreement, alice, bob, carol, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob);

    await expect(agreement.connect(bob).rateCounterparty(requestId, 5)).to.be.revertedWith("trade not awaiting ratings");

    await agreement.connect(alice).confirmTradeCompletion(requestId);
    await agreement.connect(bob).confirmTradeCompletion(requestId);

    await expect(agreement.connect(bob).rateCounterparty(requestId, 0)).to.be.revertedWith("rating must be 1-5");
    await expect(agreement.connect(bob).rateCounterparty(requestId, 6)).to.be.revertedWith("rating must be 1-5");
    await expect(agreement.connect(carol).rateCounterparty(requestId, 5)).to.be.revertedWith("not a trade party");

    await agreement.connect(bob).rateCounterparty(requestId, 5);
    await expect(agreement.connect(bob).rateCounterparty(requestId, 1)).to.be.revertedWith("already rated");
  });

  it("keeps the stakes locked while a rating is outstanding, and refuses early finalisation", async function () {
    const { agreement, token, escrow, bob, requestId } = await awaitingRatings();
    await agreement.connect(bob).rateCounterparty(requestId, 5);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(X * 2n);
    await expect(agreement.finalizeTrade(requestId)).to.be.revertedWith("rating window still open");
  });

  it("after the window closes anyone can finalise: the unrated party's counterparty gets the 5-star default", async function () {
    const { agreement, token, escrow, reputation, deployer, alice, bob, requestId, R } = await awaitingRatings();

    await agreement.connect(bob).rateCounterparty(requestId, 2);    // Bob rates Alice 2; Alice never rates Bob
    await time.increaseTo((await R(requestId)).ratingDeadline + 1n);

    await expect(agreement.connect(alice).rateCounterparty(requestId, 1)).to.be.revertedWith("rating window closed");

    await expect(agreement.connect(deployer).finalizeTrade(requestId))
      .to.emit(agreement, "TradeCompleted")
      .withArgs(requestId, 1, alice.address, bob.address, 2, 5, PER_STAR * 2n, PER_STAR * 5n, anyValue);

    expect(await token.balanceOf(alice.address)).to.equal(btk(1000) + btk(10));   // 2 stars
    expect(await token.balanceOf(bob.address)).to.equal(btk(1000) + btk(25));     // default 5 stars
    await expectEscrowEmpty(token, escrow);

    // The default 5 is paid but is NOT counted as a real rating.
    expect((await reputation.getReputation(bob.address)).ratingCount).to.equal(0n);
    expect((await reputation.getReputation(bob.address)).completedTradeCount).to.equal(1n);
    expect((await reputation.getReputation(alice.address)).ratingCount).to.equal(1n);
  });

  it("if NEITHER party rates, both get the 5-star default after the window", async function () {
    const { agreement, token, alice, bob, requestId, R } = await awaitingRatings();
    await time.increaseTo((await R(requestId)).ratingDeadline + 1n);
    await agreement.finalizeTrade(requestId);
    expect(await token.balanceOf(alice.address)).to.equal(btk(1025));
    expect(await token.balanceOf(bob.address)).to.equal(btk(1025));
  });

  it("cannot finalise a trade that is not awaiting ratings, or one already settled", async function () {
    const { agreement, alice, bob, requestId } = await awaitingRatings();
    await agreement.connect(bob).rateCounterparty(requestId, 5);
    await agreement.connect(alice).rateCounterparty(requestId, 5);
    await expect(agreement.finalizeTrade(requestId)).to.be.revertedWith("trade not awaiting ratings");
  });

  it("lets the admin tune the rating window within bounds, and nobody else", async function () {
    const { agreement, alice } = await loadFixture(deployPlatformFixture);
    await expect(agreement.connect(alice).setRatingWindow(3600)).to.be.reverted;
    await expect(agreement.setRatingWindow(59)).to.be.revertedWith("rating window out of range");
    await expect(agreement.setRatingWindow(31 * 24 * 3600)).to.be.revertedWith("rating window out of range");
    await expect(agreement.setRatingWindow(3600)).to.emit(agreement, "RatingWindowUpdated");
    expect(await agreement.ratingWindow()).to.equal(3600n);
  });

  it("uses the window in force when the exchange was confirmed", async function () {
    const { agreement, alice, bob, openTrade, confirmBoth, R } = await loadFixture(deployPlatformFixture);
    await agreement.setRatingWindow(600);
    const { requestId } = await openTrade("barter", alice, bob);
    await confirmBoth(alice, bob, requestId);
    const req = await R(requestId);
    expect(req.ratingDeadline - req.updatedAt).to.equal(600n);
  });
});

// =============================================================================
// DISPUTES — who can raise one, and when
// =============================================================================

describe("Disputes — who can raise one", function () {
  it("BARTER: either party can, with any kind of reason, only while in escrow", async function () {
    const { agreement, alice, bob, carol, openTrade, R, D } = await loadFixture(deployPlatformFixture);

    const t1 = await openTrade("barter", alice, bob);
    await expect(agreement.connect(carol).raiseDispute(t1.requestId, NOT_RECEIVED, "x")).to.be.revertedWith("not a trade party");
    await expect(agreement.connect(alice).raiseDispute(t1.requestId, NOT_CONFIRMED, "Bob never confirmed"))
      .to.emit(agreement, "TradeDisputed")
      .withArgs(t1.requestId, 1, alice.address, NOT_CONFIRMED, "Bob never confirmed", anyValue);
    expect((await R(t1.requestId)).status).to.equal(DISPUTED);
    const d = await D(t1.requestId);
    expect(d.raisedBy).to.equal(alice.address);
    expect(d.kind).to.equal(NOT_CONFIRMED);
    expect(d.reason).to.equal("Bob never confirmed");
    expect(d.ruling).to.equal(0n);

    const t2 = await openTrade("barter", alice, bob);
    await agreement.connect(bob).raiseDispute(t2.requestId, NOT_AS_DESCRIBED, "Not as described");
    expect((await D(t2.requestId)).raisedBy).to.equal(bob.address);

    // once disputed, a second dispute (or confirming) is refused
    await expect(agreement.connect(bob).raiseDispute(t2.requestId, NOT_RECEIVED, "again")).to.be.revertedWith("trade not in escrow");
    await expect(agreement.connect(alice).confirmTradeCompletion(t2.requestId)).to.be.revertedWith("trade not in escrow");
  });

  it("SELL/BUY: the BUYER can dispute at any time, but only 'not received' / 'not as described'", async function () {
    const { agreement, alice, bob, openTrade, D } = await loadFixture(deployPlatformFixture);
    const sell = await openTrade("sell", alice, bob);          // bob buys — has not even been shipped to yet
    await expect(agreement.connect(bob).raiseDispute(sell.requestId, NOT_CONFIRMED, "x"))
      .to.be.revertedWith("buyer: item missing or wrong");
    await agreement.connect(bob).raiseDispute(sell.requestId, NOT_RECEIVED, "It never came");
    expect((await D(sell.requestId)).kind).to.equal(NOT_RECEIVED);

    const buy = await openTrade("buy", alice, bob);            // alice is the buyer here
    await agreement.connect(alice).raiseDispute(buy.requestId, NOT_AS_DESCRIBED, "Scratched");
    expect((await D(buy.requestId)).raisedBy).to.equal(alice.address);
  });

  it("SELL/BUY: the SELLER can dispute 'buyer never confirmed' — but only after marking the item shipped", async function () {
    const { agreement, alice, bob, openTrade, D } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("sell", alice, bob);

    await expect(agreement.connect(alice).raiseDispute(requestId, NOT_CONFIRMED, "He has it"))
      .to.be.revertedWith("mark the item as shipped first");
    await agreement.connect(alice).markShipped(requestId, "TRACK-1");
    await expect(agreement.connect(alice).raiseDispute(requestId, NOT_RECEIVED, "x"))
      .to.be.revertedWith("seller: buyer never confirmed");
    await expect(agreement.connect(alice).raiseDispute(requestId, NOT_CONFIRMED, "Delivered 5 days ago"))
      .to.emit(agreement, "TradeDisputed");
    expect((await D(requestId)).raisedBy).to.equal(alice.address);
  });

  it("SELL/BUY: the same holds on a BUY listing (the seller is the requester)", async function () {
    const { agreement, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId, seller } = await openTrade("buy", alice, bob);
    expect(seller.address).to.equal(bob.address);
    await agreement.connect(bob).markShipped(requestId, "");
    await expect(agreement.connect(bob).raiseDispute(requestId, NOT_CONFIRMED, "")).to.emit(agreement, "TradeDisputed");
  });

  it("limits the reason text, and refuses a dispute once the exchange is confirmed or a trade is not in escrow", async function () {
    const { agreement, alice, bob, openTrade, listBarter, request } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("sell", alice, bob);
    await expect(agreement.connect(bob).raiseDispute(requestId, NOT_RECEIVED, "z".repeat(301))).to.be.revertedWith("reason too long");
    await agreement.connect(bob).confirmTradeCompletion(requestId);
    await expect(agreement.connect(bob).raiseDispute(requestId, NOT_RECEIVED, "late")).to.be.revertedWith("trade not in escrow");

    const pending = await request(bob, await listBarter(alice));
    await expect(agreement.connect(bob).raiseDispute(pending, NOT_RECEIVED, "x")).to.be.revertedWith("trade not in escrow");
  });

  it("blocks edits and deactivation while disputed, and keeps the listing closed afterwards", async function () {
    const { agreement, alice, bob, deployer, openTrade, L } = await loadFixture(deployPlatformFixture);
    const { listingId, requestId } = await openTrade("barter", alice, bob);
    await agreement.connect(alice).raiseDispute(requestId, NOT_RECEIVED, "x");
    await expect(agreement.connect(alice).deactivateListing(listingId)).to.be.revertedWith("active trade in progress");
    await agreement.connect(deployer).resolveDispute(requestId, CLAIMANT_RIGHT);
    expect((await L(listingId)).active).to.equal(false);
    expect(await agreement.activeRequest(listingId)).to.equal(0n);
  });
});

// =============================================================================
// BARTER disputes — claimant right / claimant lying
// =============================================================================

describe("BARTER rules — dispute rulings", function () {
  it("CLAIMANT RIGHT (requester): claimant gets X + 5%X*5 BTK and ALL the ETH (2Y); the other side gets nothing, its X is burned", async function () {
    const { agreement, token, escrow, reputation, deployer, alice, bob, openTrade, R, D } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob);
    await agreement.connect(bob).raiseDispute(requestId, NOT_AS_DESCRIBED, "Keyboard is broken");

    const supplyBefore = await token.totalSupply();
    const tx = agreement.connect(deployer).resolveDispute(requestId, CLAIMANT_RIGHT);
    await expect(tx).to.emit(agreement, "DisputeResolved")
      .withArgs(requestId, bob.address, alice.address, CLAIMANT_RIGHT, RET_NONE, BONUS5, X, anyValue);
    await expect(tx).to.changeEtherBalances([alice, bob, escrow], [0, Y * 2n, -(Y * 2n)]);

    expect(await token.balanceOf(bob.address)).to.equal(btk(1000) + BONUS5);     // X back + 25
    expect(await token.balanceOf(alice.address)).to.equal(btk(900));              // lost her whole X
    expect(await token.totalSupply()).to.equal(supplyBefore - X + BONUS5);        // X burned, bonus minted
    await expectEscrowEmpty(token, escrow);

    expect((await R(requestId)).status).to.equal(RESOLVED);
    const d = await D(requestId);
    expect(d.winner).to.equal(bob.address);
    expect(d.loser).to.equal(alice.address);
    expect(d.winnerBonus).to.equal(BONUS5);
    expect(d.burned).to.equal(X);

    expect(await reputation.getDisputeRecord(bob.address)).to.deep.equal([1n, 1n, 0n, 0n]);
    expect(await reputation.getDisputeRecord(alice.address)).to.deep.equal([0n, 0n, 1n, X]);
  });

  it("CLAIMANT RIGHT (the listing owner as claimant): the same rules apply symmetrically", async function () {
    const { agreement, token, escrow, deployer, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob);
    await agreement.connect(alice).raiseDispute(requestId, NOT_RECEIVED, "Never showed up");
    const tx = agreement.connect(deployer).resolveDispute(requestId, CLAIMANT_RIGHT);
    await expect(tx).to.changeEtherBalances([alice, bob], [Y * 2n, 0]);
    expect(await token.balanceOf(alice.address)).to.equal(btk(1000) + BONUS5);
    expect(await token.balanceOf(bob.address)).to.equal(btk(900));
    await expectEscrowEmpty(token, escrow);
  });

  it("CLAIMANT LYING: the other side gets X + 5%X*5 and its Y back; the claimant gets only X and Y back (no bonus)", async function () {
    const { agreement, token, escrow, reputation, deployer, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob);
    await agreement.connect(bob).raiseDispute(requestId, NOT_RECEIVED, "Lies");

    const supplyBefore = await token.totalSupply();
    const tx = agreement.connect(deployer).resolveDispute(requestId, CLAIMANT_LYING);
    await expect(tx).to.emit(agreement, "DisputeResolved")
      .withArgs(requestId, alice.address, bob.address, CLAIMANT_LYING, RET_NONE, BONUS5, 0, anyValue);
    await expect(tx).to.changeEtherBalances([alice, bob, escrow], [Y, Y, -(Y * 2n)]);

    expect(await token.balanceOf(alice.address)).to.equal(btk(1000) + BONUS5);
    expect(await token.balanceOf(bob.address)).to.equal(btk(1000));                // X back, no bonus
    expect(await token.totalSupply()).to.equal(supplyBefore + BONUS5);             // nothing burned
    await expectEscrowEmpty(token, escrow);

    expect(await reputation.getDisputeRecord(bob.address)).to.deep.equal([1n, 0n, 1n, 0n]);
    expect(await reputation.getDisputeRecord(alice.address)).to.deep.equal([0n, 1n, 0n, 0n]);
  });

  it("only accepts the two barter rulings", async function () {
    const { agreement, deployer, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob);
    await agreement.connect(bob).raiseDispute(requestId, NOT_RECEIVED, "x");
    for (const bad of [0, SELLER_WINS, BUYER_WINS_MISSING, BUYER_WINS_NOT_AS_DESCRIBED]) {
      await expect(agreement.connect(deployer).resolveDispute(requestId, bad)).to.be.revertedWith("invalid ruling for a barter");
    }
    await expect(agreement.connect(deployer).resolveDispute(requestId, 6)).to.be.reverted;   // not even an enum value
  });
});

// =============================================================================
// SELL / BUY disputes — the three outcomes
// =============================================================================

describe("SELL / BUY rules — dispute rulings", function () {
  /** SELL: alice sells to bob. BUY: alice buys from bob. Returns the parties in their roles. */
  async function setup(kind) {
    const ctx = await loadFixture(deployPlatformFixture);
    const { alice, bob, openTrade } = ctx;
    const trade = await openTrade(kind, alice, bob);
    return { ...ctx, ...trade };
  }

  for (const kind of ["sell", "buy"]) {
    describe(kind.toUpperCase(), function () {
      it("CASE 3 — SELLER WINS (fake dispute): seller gets Y ETH + X + 5%X*5; buyer gets only X back, no bonus", async function () {
        const { agreement, token, escrow, reputation, deployer, requestId, buyer, seller, D } = await setup(kind);
        await agreement.connect(buyer).raiseDispute(requestId, NOT_RECEIVED, "I never got it");

        const supplyBefore = await token.totalSupply();
        const tx = agreement.connect(deployer).resolveDispute(requestId, SELLER_WINS);
        await expect(tx).to.emit(agreement, "DisputeResolved")
          .withArgs(requestId, seller.address, buyer.address, SELLER_WINS, RET_NONE, BONUS5, 0, anyValue);
        await expect(tx).to.changeEtherBalances([seller, buyer, escrow], [PRICE, 0, -PRICE]);

        expect(await token.balanceOf(seller.address)).to.equal(btk(1000) + BONUS5);
        expect(await token.balanceOf(buyer.address)).to.equal(btk(1000));
        expect(await token.totalSupply()).to.equal(supplyBefore + BONUS5);
        await expectEscrowEmpty(token, escrow);
        expect((await D(requestId)).ruling).to.equal(SELLER_WINS);
        expect(await reputation.getDisputeRecord(buyer.address)).to.deep.equal([1n, 0n, 1n, 0n]);
        expect(await reputation.getDisputeRecord(seller.address)).to.deep.equal([0n, 1n, 0n, 0n]);
      });

      it("CASE 1 — PRODUCT MISSING (buyer wins): buyer gets Y ETH + X back; seller gets 70% of X, 30% is BURNED; no bonus to anyone", async function () {
        const { agreement, token, escrow, reputation, deployer, requestId, buyer, seller, D } = await setup(kind);
        await agreement.connect(buyer).raiseDispute(requestId, NOT_RECEIVED, "Nothing arrived");

        const supplyBefore = await token.totalSupply();
        const tx = agreement.connect(deployer).resolveDispute(requestId, BUYER_WINS_MISSING);
        await expect(tx).to.emit(agreement, "DisputeResolved")
          .withArgs(requestId, buyer.address, seller.address, BUYER_WINS_MISSING, RET_NONE, 0, btk(30), anyValue);
        await expect(tx).to.changeEtherBalances([buyer, seller, escrow], [PRICE, 0, -PRICE]);

        expect(await token.balanceOf(buyer.address)).to.equal(btk(1000));          // X back, NO bonus
        expect(await token.balanceOf(seller.address)).to.equal(btk(970));          // 70 back, 30 burned
        expect(await token.totalSupply()).to.equal(supplyBefore - btk(30));        // nothing minted
        await expectEscrowEmpty(token, escrow);

        const d = await D(requestId);
        expect(d.winner).to.equal(buyer.address);
        expect(d.burned).to.equal(btk(30));
        expect(d.winnerBonus).to.equal(0n);
        expect(await reputation.getDisputeRecord(seller.address)).to.deep.equal([0n, 0n, 1n, btk(30)]);
        expect((await reputation.getReputation(buyer.address)).tokensEarned).to.equal(0n);
      });

      it("CASE 2 — NOT AS DESCRIBED: nothing moves until the item is returned; then buyer gets Y ETH + X + 5%X*5, seller 85% of X (15% burned), no bonus", async function () {
        const { agreement, token, escrow, escrowAddress, reputation, deployer, requestId, buyer, seller, R, D } = await setup(kind);
        await agreement.connect(buyer).raiseDispute(requestId, NOT_AS_DESCRIBED, "It is a replica");

        await expect(agreement.connect(deployer).resolveDispute(requestId, BUYER_WINS_NOT_AS_DESCRIBED))
          .to.emit(agreement, "ReturnRequested").withArgs(requestId, buyer.address, seller.address, anyValue);

        // ── nothing has been released yet ──
        expect((await R(requestId)).status).to.equal(RETURN_PENDING);
        expect(await token.balanceOf(escrowAddress)).to.equal(X * 2n);
        expect(await ethers.provider.getBalance(escrowAddress)).to.equal(PRICE);
        expect((await D(requestId)).winner).to.equal(buyer.address);

        // ── the buyer sends it back (tracking), the seller confirms ──
        await expect(agreement.connect(seller).markReturned(requestId, "x")).to.be.revertedWith("only the buyer returns the item");
        await expect(agreement.connect(buyer).markReturned(requestId, "z".repeat(301))).to.be.revertedWith("note too long");
        await expect(agreement.connect(buyer).markReturned(requestId, "RET-77"))
          .to.emit(agreement, "ReturnMarked").withArgs(requestId, buyer.address, "RET-77", anyValue);
        expect((await D(requestId)).returnNote).to.equal("RET-77");
        await expect(agreement.connect(buyer).markReturned(requestId, "again")).to.be.revertedWith("already marked returned");

        await expect(agreement.connect(buyer).confirmReturnReceived(requestId)).to.be.revertedWith("only the seller confirms return");

        const supplyBefore = await token.totalSupply();
        const tx = agreement.connect(seller).confirmReturnReceived(requestId);
        await expect(tx).to.emit(agreement, "DisputeResolved")
          .withArgs(requestId, buyer.address, seller.address, BUYER_WINS_NOT_AS_DESCRIBED, RET_SELLER, BONUS5, btk(15), anyValue);
        await expect(tx).to.changeEtherBalances([buyer, seller, escrow], [PRICE, 0, -PRICE]);

        expect(await token.balanceOf(buyer.address)).to.equal(btk(1000) + BONUS5);   // X back + 5-star bonus
        expect(await token.balanceOf(seller.address)).to.equal(btk(985));            // 85 back, 15 burned, NO bonus
        expect(await token.totalSupply()).to.equal(supplyBefore - btk(15) + BONUS5);
        await expectEscrowEmpty(token, escrow);
        expect((await R(requestId)).status).to.equal(RESOLVED);
        expect((await D(requestId)).returnResult).to.equal(RET_SELLER);
        expect(await reputation.getDisputeRecord(seller.address)).to.deep.equal([0n, 0n, 1n, btk(15)]);
      });

      it("CASE 2 — the admin can close a stuck return: 'it was returned' pays the same as the seller confirming", async function () {
        const { agreement, token, escrow, deployer, requestId, buyer, seller, D } = await setup(kind);
        await agreement.connect(buyer).raiseDispute(requestId, NOT_AS_DESCRIBED, "Wrong model");
        await agreement.connect(deployer).resolveDispute(requestId, BUYER_WINS_NOT_AS_DESCRIBED);

        await expect(agreement.connect(seller).adminCloseReturn(requestId, true)).to.be.reverted;   // not the admin
        const tx = agreement.connect(deployer).adminCloseReturn(requestId, true);
        await expect(tx).to.emit(agreement, "DisputeResolved")
          .withArgs(requestId, buyer.address, seller.address, BUYER_WINS_NOT_AS_DESCRIBED, RET_ADMIN, BONUS5, btk(15), anyValue);
        await expect(tx).to.changeEtherBalances([buyer, seller], [PRICE, 0]);
        expect(await token.balanceOf(buyer.address)).to.equal(btk(1000) + BONUS5);
        expect(await token.balanceOf(seller.address)).to.equal(btk(985));
        expect((await D(requestId)).returnResult).to.equal(RET_ADMIN);
        await expectEscrowEmpty(token, escrow);
      });

      it("CASE 2 — if the buyer NEVER returns it, the admin closes it in the seller's favour (the Case 3 payout)", async function () {
        const { agreement, token, escrow, deployer, requestId, buyer, seller, D } = await setup(kind);
        await agreement.connect(buyer).raiseDispute(requestId, NOT_AS_DESCRIBED, "Wrong model");
        await agreement.connect(deployer).resolveDispute(requestId, BUYER_WINS_NOT_AS_DESCRIBED);

        const tx = agreement.connect(deployer).adminCloseReturn(requestId, false);
        await expect(tx).to.emit(agreement, "DisputeResolved")
          .withArgs(requestId, seller.address, buyer.address, BUYER_WINS_NOT_AS_DESCRIBED, RET_NOT_RETURNED, BONUS5, 0, anyValue);
        await expect(tx).to.changeEtherBalances([seller, buyer], [PRICE, 0]);
        expect(await token.balanceOf(seller.address)).to.equal(btk(1000) + BONUS5);
        expect(await token.balanceOf(buyer.address)).to.equal(btk(1000));
        expect((await D(requestId)).winner).to.equal(seller.address);
        await expectEscrowEmpty(token, escrow);
      });

      it("a SELLER-raised dispute (buyer never confirms) is ruled with the same three outcomes", async function () {
        const { agreement, token, escrow, reputation, deployer, requestId, buyer, seller } = await setup(kind);
        await agreement.connect(seller).markShipped(requestId, "DELIVERED");
        await agreement.connect(seller).raiseDispute(requestId, NOT_CONFIRMED, "He has had it for a week");

        // the seller is right: the buyer is simply sitting on it → the seller is paid and earns the bonus
        const tx = agreement.connect(deployer).resolveDispute(requestId, SELLER_WINS);
        await expect(tx).to.changeEtherBalances([seller, buyer], [PRICE, 0]);
        expect(await token.balanceOf(seller.address)).to.equal(btk(1000) + BONUS5);
        expect(await token.balanceOf(buyer.address)).to.equal(btk(1000));
        expect(await reputation.getDisputeRecord(seller.address)).to.deep.equal([1n, 1n, 0n, 0n]);   // raised, won
        await expectEscrowEmpty(token, escrow);
      });

      it("a SELLER-raised dispute can still be ruled for the BUYER (the seller never really delivered)", async function () {
        const { agreement, token, escrow, reputation, deployer, requestId, buyer, seller } = await setup(kind);
        await agreement.connect(seller).markShipped(requestId, "");
        await agreement.connect(seller).raiseDispute(requestId, NOT_CONFIRMED, "Buyer ghosted me");

        const tx = agreement.connect(deployer).resolveDispute(requestId, BUYER_WINS_MISSING);
        await expect(tx).to.changeEtherBalances([buyer, seller], [PRICE, 0]);
        expect(await token.balanceOf(buyer.address)).to.equal(btk(1000));
        expect(await token.balanceOf(seller.address)).to.equal(btk(970));
        expect(await reputation.getDisputeRecord(seller.address)).to.deep.equal([1n, 0n, 1n, btk(30)]);  // raised, lost, slashed
        await expectEscrowEmpty(token, escrow);
      });
    });
  }

  it("only accepts the three sell/buy rulings, only from the admin, only on a disputed trade, only once", async function () {
    const { agreement, deployer, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId, buyer } = await openTrade("sell", alice, bob);

    await expect(agreement.connect(deployer).resolveDispute(requestId, SELLER_WINS)).to.be.revertedWith("not disputed");
    await agreement.connect(buyer).raiseDispute(requestId, NOT_RECEIVED, "x");
    await expect(agreement.connect(buyer).resolveDispute(requestId, BUYER_WINS_MISSING)).to.be.reverted;      // not admin
    await expect(agreement.connect(alice).resolveDispute(requestId, SELLER_WINS)).to.be.reverted;             // not admin
    for (const bad of [0, CLAIMANT_RIGHT, CLAIMANT_LYING]) {
      await expect(agreement.connect(deployer).resolveDispute(requestId, bad)).to.be.revertedWith("invalid ruling for a sell/buy");
    }
    await agreement.connect(deployer).resolveDispute(requestId, SELLER_WINS);
    await expect(agreement.connect(deployer).resolveDispute(requestId, SELLER_WINS)).to.be.revertedWith("not disputed");
  });

  it("the return step only exists after a not-as-described ruling", async function () {
    const { agreement, deployer, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId, buyer, seller } = await openTrade("sell", alice, bob);
    await expect(agreement.connect(buyer).markReturned(requestId, "x")).to.be.revertedWith("no return is pending");
    await expect(agreement.connect(seller).confirmReturnReceived(requestId)).to.be.revertedWith("no return is pending");
    await expect(agreement.connect(deployer).adminCloseReturn(requestId, true)).to.be.revertedWith("no return is pending");
    await agreement.connect(buyer).raiseDispute(requestId, NOT_RECEIVED, "x");
    await agreement.connect(deployer).resolveDispute(requestId, BUYER_WINS_MISSING);
    await expect(agreement.connect(seller).confirmReturnReceived(requestId)).to.be.revertedWith("no return is pending");
  });

  it("a listing in RETURN_PENDING stays locked: it cannot be closed until the return is settled", async function () {
    const { agreement, deployer, alice, bob, openTrade, L } = await loadFixture(deployPlatformFixture);
    const { listingId, requestId, buyer, seller } = await openTrade("sell", alice, bob);
    await agreement.connect(buyer).raiseDispute(requestId, NOT_AS_DESCRIBED, "x");
    await agreement.connect(deployer).resolveDispute(requestId, BUYER_WINS_NOT_AS_DESCRIBED);
    await expect(agreement.connect(seller).deactivateListing(listingId)).to.be.revertedWith("active trade in progress");
    await agreement.connect(seller).confirmReturnReceived(requestId);
    expect((await L(listingId)).active).to.equal(false);
    expect(await agreement.activeRequest(listingId)).to.equal(0n);
  });

  it("the penalty maths holds for an odd X (the burned part is exactly X minus what is returned)", async function () {
    const { agreement, token, escrow, deployer, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const odd = btk(33) + 7n;                                   // 33.000000000000000007 BTK
    const { requestId, buyer, seller } = await openTrade("sell", alice, bob, { lock: odd });
    await agreement.connect(buyer).raiseDispute(requestId, NOT_RECEIVED, "x");
    const supplyBefore = await token.totalSupply();
    await agreement.connect(deployer).resolveDispute(requestId, BUYER_WINS_MISSING);
    const back = (odd * 70n) / 100n;
    expect(await token.balanceOf(seller.address)).to.equal(btk(1000) - odd + back);
    expect(await token.totalSupply()).to.equal(supplyBefore - (odd - back));
    await expectEscrowEmpty(token, escrow);
  });
});

// =============================================================================
// Calling a trade off by agreement
// =============================================================================

describe("Calling a trade off after everything is locked", function () {
  for (const kind of ["barter", "sell", "buy"]) {
    it(`${kind.toUpperCase()}: either side proposes, the other agrees → EVERYTHING locked is refunded, no bonus, no penalty`, async function () {
      const { agreement, token, escrow, escrowAddress, alice, bob, openTrade, R, L } = await loadFixture(deployPlatformFixture);
      const { listingId, requestId } = await openTrade(kind, alice, bob);
      const req = await R(requestId);
      const lockedEth = req.requesterEthLocked + req.ownerEthLocked;
      expect(await token.balanceOf(escrowAddress)).to.equal(X * 2n);

      await expect(agreement.connect(bob).proposeCancel(requestId))
        .to.emit(agreement, "CancelProposed").withArgs(requestId, bob.address, anyValue);
      expect((await R(requestId)).cancelProposedBy).to.equal(bob.address);

      const supplyBefore = await token.totalSupply();
      const tx = agreement.connect(alice).respondCancel(requestId, true);
      await expect(tx).to.emit(agreement, "TradeCancelledInEscrow").withArgs(requestId, listingId, anyValue);
      await expect(tx).to.changeEtherBalances(
        [alice, bob, escrow],
        [req.ownerEthLocked, req.requesterEthLocked, -lockedEth]
      );

      expect(await token.balanceOf(alice.address)).to.equal(btk(1000));
      expect(await token.balanceOf(bob.address)).to.equal(btk(1000));
      expect(await token.totalSupply()).to.equal(supplyBefore);                    // nothing minted, nothing burned
      await expectEscrowEmpty(token, escrow);
      expect((await R(requestId)).status).to.equal(CANCELLED_IN_ESCROW);
      expect(await agreement.activeRequest(listingId)).to.equal(0n);
      expect((await L(listingId)).active).to.equal(true);                          // the listing stays open
    });
  }

  it("the OWNER can propose too, and after a cancellation the listing can take a new request", async function () {
    const { agreement, token, alice, bob, carol, openTrade, request, accept, R } = await loadFixture(deployPlatformFixture);
    const { listingId, requestId } = await openTrade("sell", alice, bob);
    await agreement.connect(alice).proposeCancel(requestId);
    await agreement.connect(bob).respondCancel(requestId, true);

    const second = await request(carol, listingId, "");
    await accept(alice, second);
    expect((await R(second)).status).to.equal(IN_ESCROW);
  });

  it("you cannot accept your own proposal; the other side can decline; the proposer can withdraw", async function () {
    const { agreement, alice, bob, openTrade, R } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("sell", alice, bob);

    await expect(agreement.connect(alice).respondCancel(requestId, false)).to.be.revertedWith("no cancellation proposed");
    await agreement.connect(bob).proposeCancel(requestId);
    await expect(agreement.connect(alice).proposeCancel(requestId)).to.be.revertedWith("cancellation already proposed");
    await expect(agreement.connect(bob).respondCancel(requestId, true)).to.be.revertedWith("cannot accept your own proposal");

    // the other side says no → the trade carries on
    await expect(agreement.connect(alice).respondCancel(requestId, false))
      .to.emit(agreement, "CancelProposalCleared").withArgs(requestId, alice.address, true, anyValue);
    expect((await R(requestId)).cancelProposedBy).to.equal(ethers.ZeroAddress);
    expect((await R(requestId)).status).to.equal(IN_ESCROW);

    // propose again, then take it back
    await agreement.connect(bob).proposeCancel(requestId);
    await expect(agreement.connect(bob).respondCancel(requestId, false))
      .to.emit(agreement, "CancelProposalCleared").withArgs(requestId, bob.address, false, anyValue);
    expect((await R(requestId)).cancelProposedBy).to.equal(ethers.ZeroAddress);
  });

  it("only the two parties, and only while the trade is in escrow", async function () {
    const { agreement, alice, bob, carol, deployer, openTrade, request, listSell } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("sell", alice, bob);
    await expect(agreement.connect(carol).proposeCancel(requestId)).to.be.revertedWith("not a trade party");
    await expect(agreement.connect(deployer).proposeCancel(requestId)).to.be.revertedWith("not a trade party");

    const pending = await request(carol, await listSell(alice), "");
    await expect(agreement.connect(carol).proposeCancel(pending)).to.be.revertedWith("trade not in escrow");

    await agreement.connect(bob).confirmTradeCompletion(requestId);
    await expect(agreement.connect(bob).proposeCancel(requestId)).to.be.revertedWith("trade not in escrow");
  });

  it("if the other side refuses or goes silent, a dispute is still available (and clears the proposal)", async function () {
    const { agreement, alice, bob, openTrade, R } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("sell", alice, bob);
    await agreement.connect(bob).proposeCancel(requestId);
    await agreement.connect(bob).raiseDispute(requestId, NOT_RECEIVED, "He won't answer");
    expect((await R(requestId)).cancelProposedBy).to.equal(ethers.ZeroAddress);
    await expect(agreement.connect(alice).respondCancel(requestId, true)).to.be.revertedWith("trade not in escrow");
  });
});

// =============================================================================
// The admin — no trading, no reputation, a dispute history
// =============================================================================

describe("The admin", function () {
  it("can NOT trade: no listings, no requests", async function () {
    const { agreement, token, deployer, alice, listBarter, approveEscrow } = await loadFixture(deployPlatformFixture);
    await expect(agreement.connect(deployer).createListing(BARTER, "Item", "Cat", "Desc", "Wanted", "", Y, X))
      .to.be.revertedWith("the admin cannot trade");
    await expect(agreement.connect(deployer).createListing(SELL, "Item", "Cat", "Desc", "", PHOTO, PRICE, X))
      .to.be.revertedWith("the admin cannot trade");
    await expect(agreement.connect(deployer).createListing(BUY, "Item", "Cat", "Desc", "", "", PRICE, X))
      .to.be.revertedWith("the admin cannot trade");

    const listingId = await listBarter(alice);
    await approveEscrow(deployer, X);
    await expect(agreement.connect(deployer).requestTrade(listingId, "Anything", "", "", { value: Y }))
      .to.be.revertedWith("the admin cannot trade");
  });

  it("therefore has no reputation record at all, even after it has ruled on disputes", async function () {
    const { agreement, reputation, deployer, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId, buyer } = await openTrade("sell", alice, bob);
    await agreement.connect(buyer).raiseDispute(requestId, NOT_RECEIVED, "x");
    await agreement.connect(deployer).resolveDispute(requestId, SELLER_WINS);

    const rep = await reputation.getReputation(deployer.address);
    expect(rep.completedTradeCount).to.equal(0n);
    expect(rep.ratingCount).to.equal(0n);
    expect(rep.tokensEarned).to.equal(0n);
    expect(await reputation.getDisputeRecord(deployer.address)).to.deep.equal([0n, 0n, 0n, 0n]);
  });

  it("keeps a HISTORY of every dispute: who raised it, why, what was ruled, who won, what was burned", async function () {
    const { agreement, deployer, alice, bob, carol, openTrade, D } = await loadFixture(deployPlatformFixture);
    expect(await agreement.totalDisputes()).to.equal(0n);
    expect(await agreement.getAllDisputeIds()).to.deep.equal([]);

    const t1 = await openTrade("barter", alice, bob);
    const t2 = await openTrade("sell", carol, bob);
    const t3 = await openTrade("buy", alice, carol);
    await agreement.connect(bob).raiseDispute(t1.requestId, NOT_RECEIVED, "no keyboard");
    await agreement.connect(t2.buyer).raiseDispute(t2.requestId, NOT_AS_DESCRIBED, "not a Canon");
    await agreement.connect(t3.seller).markShipped(t3.requestId, "T3");
    await agreement.connect(t3.seller).raiseDispute(t3.requestId, NOT_CONFIRMED, "no answer");

    expect(await agreement.totalDisputes()).to.equal(3n);
    const ids = (await agreement.getAllDisputeIds()).map(Number);
    expect(ids).to.deep.equal([t1.requestId, t2.requestId, t3.requestId].map(Number));

    // t1 is ruled; t2 is ruled "not as described" and waits for the return; t3 is still open
    await agreement.connect(deployer).resolveDispute(t1.requestId, CLAIMANT_LYING);
    await agreement.connect(deployer).resolveDispute(t2.requestId, BUYER_WINS_NOT_AS_DESCRIBED);

    const [h1, h2, h3] = await agreement.getDisputesBatch(ids);
    expect(h1.requestId).to.equal(t1.requestId);
    expect(h1.raisedBy).to.equal(bob.address);
    expect(h1.kind).to.equal(NOT_RECEIVED);
    expect(h1.reason).to.equal("no keyboard");
    expect(h1.ruling).to.equal(CLAIMANT_LYING);
    expect(h1.winner).to.equal(alice.address);
    expect(h1.loser).to.equal(bob.address);
    expect(h1.winnerBonus).to.equal(BONUS5);
    expect(h1.burned).to.equal(0n);
    expect(h1.raisedAt).to.be.gt(0n);
    expect(h1.resolvedAt).to.be.gte(h1.raisedAt);
    expect(h1.closedAt).to.be.gte(h1.resolvedAt);

    expect(h2.ruling).to.equal(BUYER_WINS_NOT_AS_DESCRIBED);
    expect(h2.closedAt).to.equal(0n);                                            // waiting for the return
    expect(h2.winner).to.equal(t2.buyer.address);

    expect(h3.raisedBy).to.equal(t3.seller.address);
    expect(h3.kind).to.equal(NOT_CONFIRMED);
    expect(h3.ruling).to.equal(0n);                                              // not ruled yet
    expect(h3.winner).to.equal(ethers.ZeroAddress);
  });

  it("a request that was never disputed has an empty dispute record", async function () {
    const { alice, bob, openTrade, D } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob);
    expect((await D(requestId)).raisedBy).to.equal(ethers.ZeroAddress);
  });

  it("can hand the role only to a wallet that has never traded, and can never renounce it", async function () {
    const { agreement, deployer, alice, bob, eve, listBarter, openTrade } = await loadFixture(deployPlatformFixture);
    await openTrade("barter", alice, bob);

    await expect(agreement.connect(deployer).renounceOwnership()).to.be.revertedWith("admin role cannot be renounced");
    await expect(agreement.connect(alice).transferOwnership(eve.address)).to.be.reverted;           // not the admin
    await expect(agreement.connect(deployer).transferOwnership(alice.address)).to.be.revertedWith("new admin must not be a trader");
    await expect(agreement.connect(deployer).transferOwnership(bob.address)).to.be.revertedWith("new admin must not be a trader");

    await agreement.connect(deployer).transferOwnership(eve.address);
    expect(await agreement.owner()).to.equal(eve.address);

    // the new admin cannot trade; the old one now can
    await expect(agreement.connect(eve).createListing(BARTER, "Item", "Cat", "Desc", "Wanted", "", Y, X))
      .to.be.revertedWith("the admin cannot trade");
    await expect(agreement.connect(deployer).createListing(BARTER, "Item", "Cat", "Desc", "Wanted", "", Y, X))
      .to.not.be.reverted;
  });

  it("is the only wallet that can rule — including after the role moves", async function () {
    const { agreement, deployer, alice, bob, eve, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("barter", alice, bob);
    await agreement.connect(bob).raiseDispute(requestId, NOT_RECEIVED, "x");
    await agreement.connect(deployer).transferOwnership(eve.address);
    await expect(agreement.connect(deployer).resolveDispute(requestId, CLAIMANT_RIGHT)).to.be.reverted;
    await expect(agreement.connect(eve).resolveDispute(requestId, CLAIMANT_RIGHT)).to.emit(agreement, "DisputeResolved");
  });
});

// =============================================================================
// Access control, wiring and safety
// =============================================================================

describe("Access control and safety", function () {
  it("Escrow can only be driven by BarterAgreement", async function () {
    const { escrow, alice, bob } = await loadFixture(deployPlatformFixture);
    const id = ethers.id("fake");
    const msg = "Escrow: caller is not BarterAgreement";
    await expect(escrow.connect(alice).lockRequesterSide(id, alice.address, bob.address, X)).to.be.revertedWith(msg);
    await expect(escrow.connect(alice).lockOwnerSide(id, X)).to.be.revertedWith(msg);
    await expect(escrow.connect(alice).releaseEth(id, 0, 0)).to.be.revertedWith(msg);
    await expect(escrow.connect(alice).releaseTokens(id, 0, 0)).to.be.revertedWith(msg);
    await expect(escrow.connect(alice).refund(id)).to.be.revertedWith(msg);
  });

  it("even BarterAgreement cannot make the Escrow pay out more than it holds (the split must add up exactly)", async function () {
    const { agreement, escrow, token, alice, bob, openTrade } = await loadFixture(deployPlatformFixture);
    const { requestId } = await openTrade("sell", alice, bob);
    const id = await agreement.requestEscrowId(requestId);

    // Impersonate the BarterAgreement contract to call the Escrow directly.
    const agreementAddress = await agreement.getAddress();
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [agreementAddress] });
    await network.provider.send("hardhat_setBalance", [agreementAddress, "0xde0b6b3a7640000"]);
    const asAgreement = await ethers.getSigner(agreementAddress);

    await expect(escrow.connect(asAgreement).releaseEth(id, PRICE, 1n)).to.be.revertedWith("Escrow: ETH split must equal the amount held");
    await expect(escrow.connect(asAgreement).releaseEth(id, PRICE - 1n, 0)).to.be.revertedWith("Escrow: ETH split must equal the amount held");
    await escrow.connect(asAgreement).releaseEth(id, PRICE, 0);                          // exactly what is held is fine

    await expect(escrow.connect(asAgreement).releaseTokens(id, X + 1n, X)).to.be.revertedWith("Escrow: more than the requester locked");
    await expect(escrow.connect(asAgreement).releaseTokens(id, X, X + 1n)).to.be.revertedWith("Escrow: more than the owner locked");
    await escrow.connect(asAgreement).releaseTokens(id, X, X);
    await expect(escrow.connect(asAgreement).releaseTokens(id, X, X)).to.be.revertedWith("Escrow: eth not settled");
    await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [agreementAddress] });
    await expectEscrowEmpty(token, escrow);
  });

  it("the Escrow's link to BarterAgreement is set once and can never be re-pointed (not even by the admin)", async function () {
    const { deployer, escrow, agreement, alice } = await loadFixture(deployPlatformFixture);
    expect(await escrow.barterAgreement()).to.equal(await agreement.getAddress());
    await expect(escrow.connect(deployer).setBarterAgreement(alice.address)).to.be.revertedWith("Escrow: BarterAgreement already set");
    await expect(escrow.connect(alice).setBarterAgreement(alice.address)).to.be.reverted;
    expect(await escrow.barterAgreement()).to.equal(await agreement.getAddress());
  });

  it("Escrow refuses stray ETH", async function () {
    const { escrow, alice } = await loadFixture(deployPlatformFixture);
    await expect(alice.sendTransaction({ to: await escrow.getAddress(), value: 1 }))
      .to.be.revertedWith("Escrow: direct ETH transfers not accepted");
  });

  it("Reputation can only be written by BarterAgreement (nobody can mint themselves a bonus)", async function () {
    const { reputation, alice } = await loadFixture(deployPlatformFixture);
    await expect(reputation.connect(alice).recordSuccessfulTrade(alice.address, 5, true, btk(1000)))
      .to.be.revertedWith("Reputation: caller not BarterAgreement");
    await expect(reputation.connect(alice).recordDisputeOutcome(alice.address, alice.address, alice.address, btk(1000), 0))
      .to.be.revertedWith("Reputation: caller not BarterAgreement");
  });

  it("only the admin can change the minimum lock amount", async function () {
    const { agreement, alice } = await loadFixture(deployPlatformFixture);
    await expect(agreement.connect(alice).setMinimumLockAmount(1)).to.be.reverted;
    await expect(agreement.setMinimumLockAmount(0)).to.be.revertedWith("minimum must be > 0");
    await agreement.setMinimumLockAmount(btk(10));
    await expect(
      agreement.connect(alice).createListing(BARTER, "Item", "Cat", "Desc", "Wanted", "", Y, btk(9))
    ).to.be.revertedWith("lock amount below minimum");
  });

  it("a failed bonus mint never blocks settlement: stakes still come back and a RewardMintFailed event is emitted", async function () {
    const { token, reputation, agreement, escrow, alice, bob, openTrade, confirmBoth, R } = await loadFixture(deployPlatformFixture);

    // Break the wiring on purpose: Reputation loses its right to mint.
    await token.removeMinter(await reputation.getAddress());

    const { requestId } = await openTrade("barter", alice, bob);
    await confirmBoth(alice, bob, requestId);
    await agreement.connect(bob).rateCounterparty(requestId, 5);
    await expect(agreement.connect(alice).rateCounterparty(requestId, 5)).to.emit(reputation, "RewardMintFailed");

    expect(await token.balanceOf(alice.address)).to.equal(btk(1000));
    expect(await token.balanceOf(bob.address)).to.equal(btk(1000));
    expect((await R(requestId)).status).to.equal(COMPLETED);
    await expectEscrowEmpty(token, escrow);
  });

  it("a failed bonus mint never blocks a dispute ruling either", async function () {
    const { token, reputation, agreement, escrow, deployer, alice, bob, openTrade, R } = await loadFixture(deployPlatformFixture);
    await token.removeMinter(await reputation.getAddress());
    const { requestId, buyer } = await openTrade("sell", alice, bob);
    await agreement.connect(buyer).raiseDispute(requestId, NOT_RECEIVED, "x");
    await expect(agreement.connect(deployer).resolveDispute(requestId, SELLER_WINS)).to.emit(reputation, "RewardMintFailed");
    expect((await R(requestId)).status).to.equal(RESOLVED);
    await expectEscrowEmpty(token, escrow);
  });

  it("conserves value: the Escrow holds exactly the locked stakes, across many mixed trades, and ends empty", async function () {
    const { token, escrow, escrowAddress, agreement, deployer, alice, bob, carol, dave, openTrade, confirmBoth, shipAndConfirm } =
      await loadFixture(deployPlatformFixture);

    const t1 = await openTrade("barter", alice, bob);                                  // will complete
    const t2 = await openTrade("sell", bob, carol);                                    // missing → buyer wins
    const t3 = await openTrade("buy", carol, alice);                                   // not as described → returned
    const t4 = await openTrade("sell", dave, alice);                                   // called off
    const t5 = await openTrade("buy", dave, bob);                                      // seller wins
    expect(await token.balanceOf(escrowAddress)).to.equal(X * 10n);
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(Y * 2n + PRICE * 4n);

    await confirmBoth(alice, bob, t1.requestId);                                       // releases 2Y, leaves BTK
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(PRICE * 4n);

    await agreement.connect(t2.buyer).raiseDispute(t2.requestId, NOT_RECEIVED, "x");
    await agreement.connect(deployer).resolveDispute(t2.requestId, BUYER_WINS_MISSING);

    await agreement.connect(t3.buyer).raiseDispute(t3.requestId, NOT_AS_DESCRIBED, "x");
    await agreement.connect(deployer).resolveDispute(t3.requestId, BUYER_WINS_NOT_AS_DESCRIBED);
    await agreement.connect(t3.seller).confirmReturnReceived(t3.requestId);

    await agreement.connect(t4.buyer).proposeCancel(t4.requestId);
    await agreement.connect(t4.seller).respondCancel(t4.requestId, true);

    await agreement.connect(t5.buyer).raiseDispute(t5.requestId, NOT_RECEIVED, "x");
    await agreement.connect(deployer).resolveDispute(t5.requestId, SELLER_WINS);

    // only t1's two BTK stakes remain (awaiting ratings)
    expect(await token.balanceOf(escrowAddress)).to.equal(X * 2n);
    expect(await ethers.provider.getBalance(escrowAddress)).to.equal(0n);

    await agreement.connect(alice).rateCounterparty(t1.requestId, 5);
    await agreement.connect(bob).rateCounterparty(t1.requestId, 5);
    await expectEscrowEmpty(token, escrow);
  });
});
