// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IBarterPlatform.sol";

/**
 * @title  BarterAgreement
 * @author Your Group Name
 * @notice The core marketplace contract — the brain of the Decentralized Barter DApp.
 *         It is the AUTHORITY for listings, trade status and funds: the web
 *         app and the database only mirror what happens here.
 *
 * ─── Listing types (exactly three) ────────────────────────────────────────────
 *
 *   BARTER    Item-for-item swap. Both sides lock X BTK AND Y ETH (a deposit each).
 *   SELL      The owner sells an item for Y ETH; the requester (buyer) pays it.
 *   BUY       The owner wants an item and offers Y ETH; the requester (seller)
 *             supplies the item and is paid.
 *
 *   X = BTK lock amount, Y = ETH amount. BOTH are set by the listing owner.
 *
 * ─── What is locked ───────────────────────────────────────────────────────────
 *
 *   BARTER   each side:  X BTK + Y ETH            (total 2X BTK + 2Y ETH)
 *   SELL/BUY seller:     X BTK
 *            buyer:      X BTK + Y ETH            (total 2X BTK + Y ETH)
 *
 * ─── BARTER rules  (BTK & ETH TRADE WORKFLOW) ─────────────────────────────────
 *
 *   Both parties confirm the swap happened → each gets their Y ETH back at once,
 *   then each rates the other (1–5 stars):
 *       each party gets   X BTK  +  5% of X × stars the OTHER party gave.
 *   Either party can raise a dispute while the trade is in escrow; the admin rules:
 *       claimant RIGHT  → claimant gets X + 5%·X·5 BTK and ALL the ETH (2Y);
 *                         the other side gets nothing (their X is burned).
 *       claimant LYING  → the other side gets X + 5%·X·5 BTK and its Y ETH;
 *                         the claimant gets only X BTK and its Y ETH (no bonus).
 *
 * ─── SELL / BUY rules  (BUY / SELL OPTION WORKFLOW) ───────────────────────────
 *
 *   The seller ships (markShipped); the BUYER confirms receipt:
 *       seller gets  Y ETH + X BTK + 5% of X × stars the buyer gave
 *       buyer  gets  X BTK + 5% of X × stars the seller gave
 *   The buyer can dispute at any time while in escrow (item missing / not as
 *   described); the seller can dispute once it has shipped (the buyer never
 *   confirms). The admin rules (the same three outcomes whoever raised it):
 *       SELLER_WINS (fake dispute) → seller: Y ETH + X BTK + 5%·X·5 bonus
 *                                    buyer : X BTK back, no bonus
 *       BUYER_WINS_MISSING         → buyer : Y ETH back + X BTK back
 *                                    seller: 70% of X back, 30% of X BURNED, no bonus
 *       BUYER_WINS_NOT_AS_DESCRIBED→ the buyer must RETURN the item first;
 *                                    once the seller confirms receiving it (or the
 *                                    admin closes the return):
 *                                    buyer : Y ETH back + X BTK back + 5%·X·5 bonus
 *                                    seller: 85% of X back, 15% of X BURNED, no bonus
 *                                    (if the item is never returned the admin closes
 *                                     it as SELLER_WINS instead)
 *
 * ─── Calling a trade off ──────────────────────────────────────────────────────
 *
 *   While a trade is in escrow either party can PROPOSE to cancel it; if the
 *   other party agrees, everything locked is refunded in full (no bonus, no
 *   penalty). If they refuse or go silent, a dispute is the way out.
 *
 * ─── The admin ────────────────────────────────────────────────────────────────
 *
 *   The admin (the contract owner) rules on disputes. The admin can NOT trade
 *   (no listings, no requests), so it has no reputation either, and the admin
 *   role can't be renounced or handed to a wallet that has ever traded.
 *   Every dispute is kept on chain, so the admin can browse past rulings.
 *
 * ─── Trade state machine ──────────────────────────────────────────────────────
 *
 *   [PENDING] ─owner accepts─► [IN_ESCROW] ─confirm(s)─► [AWAITING_RATINGS] ─► [COMPLETED]
 *      │                         │     │
 *   owner rejects /              │     └─both agree to cancel─► [CANCELLED_IN_ESCROW]
 *   requester cancels            │
 *      ▼                    raiseDispute
 *   [REJECTED / CANCELLED]       ▼
 *                           [DISPUTED] ─admin rules─► [RESOLVED]
 *                                 │
 *                                 └─ not-as-described ─► [RETURN_PENDING] ─return done─► [RESOLVED]
 *
 * ─── Deposit flow ─────────────────────────────────────────────────────────────
 *
 *   requestTrade() is payable and locks the REQUESTER's side immediately:
 *
 *     barterToken.approve(ESCROW_ADDRESS, listing.lockAmount)
 *     barterAgreement.requestTrade{value: requesterEthRequired(listingId)}(
 *       listingId, offeredItem, offeredDescription, imageHash
 *     )
 *
 *   acceptTradeRequest() is payable and locks the OWNER's side:
 *
 *     barterToken.approve(ESCROW_ADDRESS, listing.lockAmount)
 *     barterAgreement.acceptTradeRequest{value: ownerEthRequired(listingId)}(requestId)
 *
 *   IMPORTANT: both approvals go to the ESCROW contract (not this one) —
 *   Escrow is what actually calls transferFrom.
 *
 * ─── Deployment order (see deploy.js) ────────────────────────────────────────
 *
 *   1. BarterToken.deploy(owner)
 *   2. Escrow.deploy(tokenAddr, owner)
 *   3. BarterAgreement.deploy(tokenAddr, escrowAddr, owner)  ← this contract
 *   4. Reputation.deploy(tokenAddr, barterAgreementAddr, owner)
 *
 *   Then wire-up calls:
 *     escrow.setBarterAgreement(barterAgreementAddr)
 *     barterAgreement.setReputation(reputationAddr)
 *     barterToken.addMinter(reputationAddr)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract BarterAgreement is Ownable, ReentrancyGuard {

    // =========================================================================
    // External contract references
    // =========================================================================

    IEscrow     public escrow;
    IReputation public reputation;
    address     public barterToken;

    // =========================================================================
    // Rule constants
    // =========================================================================

    /// @notice Bonus per star, as a percent of the lock amount X.
    ///         bonus = X * BONUS_PERCENT / 100 * stars
    uint256 public constant BONUS_PERCENT = 5;

    /// @notice Highest rating — also the rating credited to a dispute winner
    ///         and to a party whose counterparty never rated.
    uint8 public constant MAX_STARS = 5;

    /// @notice Share of the seller's X that is BURNED when the buyer wins because
    ///         the product never arrived (Case 1).
    uint256 public constant MISSING_PENALTY_PERCENT = 30;

    /// @notice Share of the seller's X that is BURNED when the buyer wins because
    ///         the product was not as described (Case 2).
    uint256 public constant NOT_AS_DESCRIBED_PENALTY_PERCENT = 15;

    uint256 public constant MIN_RATING_WINDOW = 1 minutes;
    uint256 public constant MAX_RATING_WINDOW = 30 days;

    /// @notice Longest free-text dispute reason / shipping or return note (bytes).
    uint256 public constant MAX_TEXT_LENGTH = 300;

    /// @notice Longest photo fingerprint (bytes) accepted on a listing or request.
    uint256 public constant MAX_HASH_LENGTH = 100;

    // =========================================================================
    // Types
    // =========================================================================

    /**
     * @notice The lifecycle state of a single trade request.
     *
     *   PENDING             requester's side locked in escrow, owner has not responded yet
     *   IN_ESCROW           owner accepted and locked their side; the exchange is happening off-chain
     *   AWAITING_RATINGS    exchange confirmed; ETH has been released; the BTK stakes stay locked
     *                       until both rate (or the rating window lapses)
     *   COMPLETED           ratings settled; stakes returned with bonuses
     *   REJECTED            owner said no; requester's deposit refunded
     *   CANCELLED           requester withdrew while still PENDING; deposit refunded
     *   DISPUTED            a party claims the exchange failed; waiting for the admin
     *   RESOLVED            the admin ruled and funds were distributed
     *   RETURN_PENDING      the admin ruled "not as described": the buyer must return the item
     *   CANCELLED_IN_ESCROW both parties agreed to call the trade off; everything refunded
     */
    enum TradeStatus {
        PENDING,
        IN_ESCROW,
        AWAITING_RATINGS,
        COMPLETED,
        REJECTED,
        CANCELLED,
        DISPUTED,
        RESOLVED,
        RETURN_PENDING,
        CANCELLED_IN_ESCROW
    }

    /// @notice What kind of listing this is. Exactly three; any other value is rejected.
    enum ListingType {
        BARTER,
        SELL,
        BUY
    }

    /// @notice Why a dispute was opened (the claimant's category; the admin decides the outcome).
    enum DisputeKind {
        NOT_RECEIVED,       // the item never arrived
        NOT_AS_DESCRIBED,   // the item arrived but is not what was promised
        NOT_CONFIRMED       // the item was delivered but the other side never confirmed
    }

    /// @notice What the admin decided.
    enum Ruling {
        NONE,
        CLAIMANT_RIGHT,                 // BARTER only
        CLAIMANT_LYING,                 // BARTER only
        SELLER_WINS,                    // SELL/BUY: fake dispute / seller delivered (Case 3)
        BUYER_WINS_MISSING,             // SELL/BUY: product missing (Case 1)
        BUYER_WINS_NOT_AS_DESCRIBED     // SELL/BUY: product not as described (Case 2)
    }

    /// @notice How the "return the item" step of a not-as-described ruling ended.
    enum ReturnResult {
        NONE,
        CONFIRMED_BY_SELLER,    // the seller confirmed receiving the item back
        CONFIRMED_BY_ADMIN,     // the admin closed it as "item was returned"
        NOT_RETURNED            // the admin closed it as "item was never returned"
    }

    struct Listing {
        uint256     id;
        address     owner;
        ListingType listingType;
        string      itemName;
        string      category;         // "Electronics", "Books", etc.
        string      description;
        string      wantedItem;       // what the owner wants in exchange (BARTER only)
        string      imageHash;        // SHA-256 fingerprint of the item photo ("" if none; required for SELL)
        uint256     price;            // Y — wei: ask price (SELL), offer (BUY) or ETH deposit each side locks (BARTER)
        uint256     lockAmount;       // X — BTK-wei EACH party locks for a trade on this listing
        bool        active;
        uint256     createdAt;
        uint256     updatedAt;
    }

    struct TradeRequest {
        uint256     id;
        uint256     listingId;
        address     requester;
        string      offeredItem;
        string      offeredDescription;
        string      imageHash;           // fingerprint of the photo of what the requester offers ("" if none)
        uint256     lockAmount;          // X — copied from the listing at request time
        uint256     requesterEthLocked;  // ETH the requester locked at request time
        uint256     ownerEthLocked;      // ETH the owner locked at accept time (0 until accepted)
        TradeStatus status;
        bool        ownerConfirmed;      // BARTER: listing owner confirmed the exchange
        bool        requesterConfirmed;  // BARTER: requester confirmed the exchange
        uint8       ratingByOwner;       // stars the OWNER gave the requester (0 = not rated)
        uint8       ratingByRequester;   // stars the REQUESTER gave the owner (0 = not rated)
        uint256     ratingDeadline;      // end of the rating window (0 until the exchange is confirmed)
        bool        shipped;             // SELL/BUY: the seller marked the item as sent / handed over
        uint256     shippedAt;
        string      shippingNote;        // tracking number / proof of delivery (optional)
        address     cancelProposedBy;    // who asked to call the trade off (address(0) = nobody)
        uint256     createdAt;
        uint256     updatedAt;
    }

    /// @notice One dispute — kept forever, so the admin can read past rulings.
    struct Dispute {
        uint256      requestId;
        address      raisedBy;        // the claimant
        DisputeKind  kind;
        string       reason;          // the claimant's own words
        uint256      raisedAt;
        Ruling       ruling;          // NONE until the admin rules
        uint256      resolvedAt;      // when the admin ruled
        address      winner;
        address      loser;
        uint256      winnerBonus;     // BTK bonus minted to the winner
        uint256      burned;          // BTK burned as the penalty
        string       returnNote;      // BUYER_WINS_NOT_AS_DESCRIBED: the buyer's tracking info
        uint256      returnedAt;      // when the buyer marked the item as returned (0 = not yet)
        ReturnResult returnResult;
        uint256      closedAt;        // when the funds were finally released
    }

    /// @dev How a ruling splits what is locked.
    struct Payout {
        uint256 ethToRequester;
        uint256 ethToOwner;
        uint256 btkToRequester;
        uint256 btkToOwner;
    }

    // =========================================================================
    // Storage
    // =========================================================================

    uint256 public nextListingId = 1;
    uint256 public nextRequestId = 1;

    /// @notice Smallest lock amount X a listing may set. Prevents zero-stake trades.
    uint256 public minimumLockAmount = 1 * 10 ** 18;  // 1 BTK

    /// @notice How long after the exchange is confirmed the parties have to rate each other.
    uint256 public ratingWindow = 3 days;

    // Internal on purpose: a public getter for these wide structs would add several KB to the
    // contract. Read them with getListingsBatch / getRequestsBatch / getDisputesBatch instead.
    mapping(uint256 => Listing)      internal listings;
    mapping(uint256 => TradeRequest) internal tradeRequests;
    mapping(uint256 => Dispute)      internal disputes;      // requestId → its dispute

    /// @notice The escrow record ID for each trade request.
    ///         Generated as keccak256(abi.encodePacked("REQ", requestId)).
    mapping(uint256 => bytes32) public requestEscrowId;

    /// @notice The one request currently in progress (IN_ESCROW / DISPUTED / RETURN_PENDING) for a listing.
    ///         Prevents a listing from having two active trades at once.
    mapping(uint256 => uint256) public activeRequest;  // listingId → requestId (0 = none)

    // Lookup arrays — used by the frontend to enumerate data
    mapping(address => uint256[]) private _userListings;     // user → their listing IDs
    mapping(address => uint256[]) private _userRequests;     // requester → their request IDs
    mapping(address => uint256[]) private _ownerRequests;    // listing owner → request IDs on their listings
    mapping(uint256 => uint256[]) private _listingRequests;  // listingId → all request IDs
    uint256[] private _disputeIds;                           // every request that was ever disputed, in order

    // =========================================================================
    // Events (critical for frontend — listen to these for live updates)
    // =========================================================================

    event ListingCreated(
        uint256 indexed listingId,
        address indexed owner,
        ListingType listingType,
        string  itemName,
        string  wantedItem,
        string  category,
        uint256 price,
        uint256 lockAmount,
        uint256 timestamp
    );

    event ListingDeactivated(uint256 indexed listingId, address indexed owner, uint256 timestamp);

    event TradeRequested(
        uint256 indexed requestId,
        uint256 indexed listingId,
        address indexed requester,
        string  offeredItem,
        uint256 lockAmount,
        uint256 ethLocked,
        uint256 timestamp
    );

    event TradeRequestCancelled(
        uint256 indexed requestId,
        uint256 indexed listingId,
        address indexed requester,
        uint256 timestamp
    );

    event TradeAccepted(
        uint256 indexed requestId,
        uint256 indexed listingId,
        address indexed listingOwner,
        bytes32 escrowId,
        uint256 ownerEthLocked,
        uint256 timestamp
    );

    event TradeRejected(
        uint256 indexed requestId,
        uint256 indexed listingId,
        address indexed listingOwner,
        uint256 timestamp
    );

    /// @notice SELL/BUY: the seller says the item is on its way (or was handed over).
    event TradeShipped(uint256 indexed requestId, address indexed seller, string note, uint256 timestamp);

    event TradeConfirmed(
        uint256 indexed requestId,
        address indexed confirmer,
        bool    ownerConfirmed,
        bool    requesterConfirmed,
        uint256 timestamp
    );

    /// @notice The exchange is confirmed: ETH has been released, BTK stays locked until ratings.
    event ExchangeConfirmed(
        uint256 indexed requestId,
        uint256 indexed listingId,
        uint256 ratingDeadline,
        uint256 timestamp
    );

    event TradeRated(
        uint256 indexed requestId,
        address indexed rater,
        address indexed rated,
        uint8   stars,
        uint256 timestamp
    );

    /// @notice The trade is fully settled: stakes returned, bonuses minted.
    /// @param starsForOwner     stars the owner received (5 if the requester never rated)
    /// @param starsForRequester stars the requester received (5 if the owner never rated)
    event TradeCompleted(
        uint256 indexed requestId,
        uint256 indexed listingId,
        address indexed listingOwner,
        address requester,
        uint8   starsForOwner,
        uint8   starsForRequester,
        uint256 ownerBonus,
        uint256 requesterBonus,
        uint256 timestamp
    );

    event CancelProposed(uint256 indexed requestId, address indexed proposer, uint256 timestamp);
    /// @notice A cancellation proposal was withdrawn by its author (declined = false) or declined by the other side.
    event CancelProposalCleared(uint256 indexed requestId, address indexed by, bool declined, uint256 timestamp);
    /// @notice Both sides agreed: everything locked was refunded.
    event TradeCancelledInEscrow(uint256 indexed requestId, uint256 indexed listingId, uint256 timestamp);

    event TradeDisputed(
        uint256 indexed requestId,
        uint256 indexed listingId,
        address indexed raisedBy,
        DisputeKind kind,
        string  reason,
        uint256 timestamp
    );

    /// @notice The admin ruled "not as described": the buyer now has to send the item back.
    event ReturnRequested(uint256 indexed requestId, address indexed buyer, address indexed seller, uint256 timestamp);
    event ReturnMarked(uint256 indexed requestId, address indexed buyer, string note, uint256 timestamp);

    /// @param ruling        what the admin decided.
    /// @param returnResult  how the return step ended (NONE when there was no return).
    /// @param winnerBonus   BTK minted to the winner (5% of X x 5 stars, or 0).
    /// @param burned        BTK burned as the penalty.
    event DisputeResolved(
        uint256 indexed requestId,
        address indexed winner,
        address indexed loser,
        Ruling  ruling,
        ReturnResult returnResult,
        uint256 winnerBonus,
        uint256 burned,
        uint256 timestamp
    );

    event ReputationAddressSet(address reputation);
    event MinimumLockAmountUpdated(uint256 oldAmount, uint256 newAmount);
    event RatingWindowUpdated(uint256 oldWindow, uint256 newWindow);

    // =========================================================================
    // Modifiers
    // =========================================================================

    // The modifiers only CALL internal functions: a modifier body is copied into every
    // function that uses it, which would push the contract over the 24 KB size limit.

    modifier listingExists(uint256 listingId) {
        _listingExists(listingId);
        _;
    }

    modifier onlyListingOwner(uint256 listingId) {
        require(listings[listingId].owner == msg.sender, "not listing owner");
        _;
    }

    modifier requestExists(uint256 requestId) {
        _requestExists(requestId);
        _;
    }

    modifier onlyTradeParty(uint256 requestId) {
        _onlyTradeParty(requestId);
        _;
    }

    /// @dev The admin rules on disputes, so it must never be a party to one.
    modifier notAdmin() {
        _notAdmin();
        _;
    }

    function _listingExists(uint256 listingId) internal view {
        require(listingId > 0 && listingId < nextListingId, "listing not found");
    }

    function _requestExists(uint256 requestId) internal view {
        require(requestId > 0 && requestId < nextRequestId, "request not found");
    }

    function _onlyTradeParty(uint256 requestId) internal view {
        TradeRequest storage req = tradeRequests[requestId];
        require(
            msg.sender == req.requester || msg.sender == listings[req.listingId].owner,
            "not a trade party"
        );
    }

    function _notAdmin() internal view {
        require(msg.sender != owner(), "the admin cannot trade");
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(
        address _barterToken,
        address _escrow,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_barterToken != address(0), "zero token address");
        require(_escrow      != address(0), "zero escrow address");
        require(initialOwner != address(0), "zero owner address");

        barterToken = _barterToken;
        escrow      = IEscrow(_escrow);
    }

    // =========================================================================
    // Admin configuration
    // =========================================================================

    /**
     * @notice Point this contract at the Reputation contract.
     *         Call once after deploying Reputation.
     */
    function setReputation(address _reputation) external onlyOwner {
        require(_reputation != address(0), "zero address");
        reputation = IReputation(_reputation);
        emit ReputationAddressSet(_reputation);
    }

    function setMinimumLockAmount(uint256 amount) external onlyOwner {
        require(amount > 0, "minimum must be > 0");
        emit MinimumLockAmountUpdated(minimumLockAmount, amount);
        minimumLockAmount = amount;
    }

    /**
     * @notice Change how long parties have to rate each other after confirming.
     *         Applies to trades whose exchange is confirmed AFTER this call.
     */
    function setRatingWindow(uint256 window) external onlyOwner {
        require(
            window >= MIN_RATING_WINDOW && window <= MAX_RATING_WINDOW,
            "rating window out of range"
        );
        emit RatingWindowUpdated(ratingWindow, window);
        ratingWindow = window;
    }

    /// @notice The admin role can only go to a wallet that has never traded
    ///         (otherwise a trader could end up ruling on its own dispute).
    function transferOwnership(address newOwner) public override onlyOwner {
        require(
            _userListings[newOwner].length == 0 && _userRequests[newOwner].length == 0,
            "new admin must not be a trader"
        );
        super.transferOwnership(newOwner);
    }

    /// @notice Disabled: without an admin nobody could rule on disputes.
    function renounceOwnership() public pure override {
        revert("admin role cannot be renounced");
    }

    // =========================================================================
    // ── LISTINGS ──────────────────────────────────────────────────────────────
    // =========================================================================

    /**
     * @notice Create a listing — a barter offer, a sale, or a buy request.
     *
     * @param listingType    BARTER, SELL or BUY (see contract docs).
     * @param itemName       What the listing is about.
     * @param category       Category (e.g. "Electronics").
     * @param description    Detailed description — condition, specs.
     * @param wantedItem     What you want in return. Required for BARTER only.
     * @param imageHash      SHA-256 fingerprint of the item photo. Required for SELL;
     *                       optional ("") for BARTER and BUY.
     * @param price          Y — wei. Ask price (SELL), offer price (BUY) or the ETH
     *                       deposit BOTH sides lock (BARTER). Must be > 0.
     * @param lockAmount     X — the BTK-wei BOTH parties must lock (>= minimumLockAmount).
     *                       Also sizes the bonus: 5% of X per star.
     */
    function createListing(
        ListingType listingType,
        string calldata itemName,
        string calldata category,
        string calldata description,
        string calldata wantedItem,
        string calldata imageHash,
        uint256 price,
        uint256 lockAmount
    ) external notAdmin returns (uint256 listingId) {
        require(bytes(itemName).length > 0, "item name required");
        require(lockAmount >= minimumLockAmount, "lock amount below minimum");
        require(price > 0, "ETH amount required");
        require(bytes(imageHash).length <= MAX_HASH_LENGTH, "image hash too long");

        if (listingType == ListingType.BARTER) {
            require(bytes(wantedItem).length > 0, "wanted item required for barter");
        } else if (listingType == ListingType.SELL) {
            require(bytes(imageHash).length > 0, "photo required for sell listing");
        }

        listingId = nextListingId++;

        Listing storage l = listings[listingId];
        l.id             = listingId;
        l.owner          = msg.sender;
        l.listingType    = listingType;
        l.itemName       = itemName;
        l.category       = category;
        l.description    = description;
        l.wantedItem     = wantedItem;
        l.imageHash      = imageHash;
        l.price          = price;
        l.lockAmount     = lockAmount;
        l.active         = true;
        l.createdAt      = block.timestamp;
        l.updatedAt      = block.timestamp;

        _userListings[msg.sender].push(listingId);

        emit ListingCreated(
            listingId, msg.sender, listingType, itemName, wantedItem, category,
            price, lockAmount, block.timestamp
        );
    }

    /**
     * @notice Deactivate a listing (soft-delete — history stays on chain).
     *         Cannot deactivate while a trade is in progress.
     */
    function deactivateListing(uint256 listingId)
        external
        listingExists(listingId)
        onlyListingOwner(listingId)
    {
        require(listings[listingId].active,    "already inactive");
        require(activeRequest[listingId] == 0, "active trade in progress");

        listings[listingId].active    = false;
        listings[listingId].updatedAt = block.timestamp;

        emit ListingDeactivated(listingId, msg.sender, block.timestamp);
    }

    // =========================================================================
    // ── ETH REQUIREMENT HELPERS ───────────────────────────────────────────────
    // =========================================================================

    /**
     * @notice How much ETH the REQUESTER must attach to requestTrade():
     *         Y for BARTER (a deposit) and SELL (the requester is the buyer);
     *         0 for BUY (the requester is the seller).
     */
    function requesterEthRequired(uint256 listingId)
        public
        view
        listingExists(listingId)
        returns (uint256)
    {
        return _requesterEthRequired(listings[listingId]);
    }

    /**
     * @notice How much ETH the OWNER must attach to acceptTradeRequest():
     *         Y for BARTER (a deposit) and BUY (the owner is the buyer);
     *         0 for SELL (the owner is the seller).
     */
    function ownerEthRequired(uint256 listingId)
        public
        view
        listingExists(listingId)
        returns (uint256)
    {
        return _ownerEthRequired(listings[listingId]);
    }

    function _requesterEthRequired(Listing storage listing) internal view returns (uint256) {
        return listing.listingType == ListingType.BUY ? 0 : listing.price;
    }

    function _ownerEthRequired(Listing storage listing) internal view returns (uint256) {
        return listing.listingType == ListingType.SELL ? 0 : listing.price;
    }

    /**
     * @notice The BTK bonus for a given lock amount and star count:
     *         5% of the lock amount x stars.
     */
    function bonusFor(uint256 lockAmount, uint8 stars) external pure returns (uint256) {
        require(stars >= 1 && stars <= MAX_STARS, "rating must be 1-5");
        return _bonus(lockAmount, stars);
    }

    function _bonus(uint256 lockAmount, uint8 stars) internal pure returns (uint256) {
        return (lockAmount * BONUS_PERCENT * stars) / 100;
    }

    /**
     * @dev Who plays which role in a trade. For SELL the owner is the seller and the
     *      requester the buyer; for BUY it is the other way round. BARTER has no
     *      buyer/seller, so both are address(0).
     */
    function _buyerSeller(Listing storage listing, TradeRequest storage req)
        internal
        view
        returns (address buyer, address seller)
    {
        if (listing.listingType == ListingType.SELL) return (req.requester, listing.owner);
        if (listing.listingType == ListingType.BUY)  return (listing.owner, req.requester);
        return (address(0), address(0));
    }

    // =========================================================================
    // ── TRADE REQUESTS ────────────────────────────────────────────────────────
    // =========================================================================

    /**
     * @notice Request to trade with the owner of a listing.
     *
     *         The requester's ETH (msg.value) and X BTK are locked in the
     *         Escrow contract immediately. IMPORTANT: before calling this,
     *         the requester MUST approve the ESCROW contract (not this
     *         contract) to spend X BTK, and must attach exactly
     *         requesterEthRequired(listingId) as msg.value.
     *
     * @param listingId      Listing the requester wants to trade for.
     * @param offeredItem    Name of the item being offered. Required for BARTER and
     *                       BUY (the requester is supplying an item); optional for SELL.
     * @param offeredDesc    Description — condition, specs.
     * @param imageHash      Optional SHA-256 fingerprint of a photo of what is offered,
     *                       so the owner can see its condition before accepting.
     *
     * @return requestId     ID of the created trade request.
     */
    function requestTrade(
        uint256 listingId,
        string calldata offeredItem,
        string calldata offeredDesc,
        string calldata imageHash
    )
        external
        payable
        nonReentrant
        notAdmin
        listingExists(listingId)
        returns (uint256 requestId)
    {
        Listing storage listing = listings[listingId];

        require(listing.active,              "listing not active");
        require(listing.owner != msg.sender, "cannot trade with yourself");
        require(bytes(imageHash).length <= MAX_HASH_LENGTH, "image hash too long");

        if (listing.listingType != ListingType.SELL) {
            require(bytes(offeredItem).length > 0, "offered item required");
        }

        require(msg.value == _requesterEthRequired(listing), "incorrect ETH amount sent");

        // Prevent duplicate pending requests from the same user on the same listing
        uint256[] storage existingIds = _listingRequests[listingId];
        for (uint256 i = 0; i < existingIds.length; i++) {
            TradeRequest storage ex = tradeRequests[existingIds[i]];
            if (ex.requester == msg.sender && ex.status == TradeStatus.PENDING) {
                revert("duplicate pending request");
            }
        }

        requestId        = nextRequestId++;
        bytes32 escrowId = keccak256(abi.encodePacked("REQ", requestId));

        TradeRequest storage req = tradeRequests[requestId];
        req.id                 = requestId;
        req.listingId          = listingId;
        req.requester          = msg.sender;
        req.offeredItem        = offeredItem;
        req.offeredDescription = offeredDesc;
        req.imageHash          = imageHash;
        req.lockAmount         = listing.lockAmount;
        req.requesterEthLocked = msg.value;
        req.status             = TradeStatus.PENDING;
        req.createdAt          = block.timestamp;
        req.updatedAt          = block.timestamp;

        requestEscrowId[requestId] = escrowId;
        _listingRequests[listingId].push(requestId);
        _userRequests[msg.sender].push(requestId);
        _ownerRequests[listing.owner].push(requestId);

        // Lock the requester's side: ETH forwarded from this call + X BTK pulled
        // from their Escrow allowance.
        escrow.lockRequesterSide{value: msg.value}(escrowId, msg.sender, listing.owner, listing.lockAmount);

        emit TradeRequested(
            requestId, listingId, msg.sender, offeredItem, listing.lockAmount, msg.value, block.timestamp
        );
    }

    /**
     * @notice Cancel a trade request the caller created.
     *         Only works while the request is still PENDING (not yet accepted).
     *         Everything the requester locked is fully refunded.
     */
    function cancelTradeRequest(uint256 requestId)
        external
        nonReentrant
        requestExists(requestId)
    {
        TradeRequest storage req = tradeRequests[requestId];

        require(req.requester == msg.sender,      "not the requester");
        require(req.status == TradeStatus.PENDING,"can only cancel pending requests");

        req.status    = TradeStatus.CANCELLED;
        req.updatedAt = block.timestamp;

        escrow.refund(requestEscrowId[requestId]);

        emit TradeRequestCancelled(requestId, req.listingId, msg.sender, block.timestamp);
    }

    /**
     * @notice Accept a trade request (listing owner only).
     *
     *         Locks the OWNER's side of the trade — their ETH (msg.value)
     *         and X BTK, the same amount the requester already locked.
     *         IMPORTANT: approve the ESCROW contract for X first, and attach
     *         exactly ownerEthRequired(listingId) as msg.value.
     *
     *         Moves the request to IN_ESCROW and automatically rejects all
     *         other pending requests on this listing, refunding their deposits.
     */
    function acceptTradeRequest(uint256 requestId)
        external
        payable
        nonReentrant
        requestExists(requestId)
    {
        TradeRequest storage req     = tradeRequests[requestId];
        Listing      storage listing = listings[req.listingId];

        require(listing.owner == msg.sender,       "not listing owner");
        require(listing.active,                    "listing not active");
        require(req.status == TradeStatus.PENDING, "request not pending");
        require(activeRequest[req.listingId] == 0, "listing already has a trade");
        require(msg.value == _ownerEthRequired(listing), "incorrect ETH amount sent");

        req.status         = TradeStatus.IN_ESCROW;
        req.ownerEthLocked = msg.value;
        req.updatedAt      = block.timestamp;

        activeRequest[req.listingId] = requestId;

        // Lock the owner's side: ETH forwarded from this call + X BTK, matching
        // the requester's exactly.
        escrow.lockOwnerSide{value: msg.value}(requestEscrowId[requestId], req.lockAmount);

        // Reject (and refund) all other pending requests on this listing
        _rejectOtherRequests(req.listingId, requestId);

        emit TradeAccepted(
            requestId, req.listingId, msg.sender, requestEscrowId[requestId], msg.value, block.timestamp
        );
    }

    /**
     * @notice Reject a trade request (listing owner only).
     *         The requester's lock is refunded immediately.
     */
    function rejectTradeRequest(uint256 requestId)
        external
        nonReentrant
        requestExists(requestId)
    {
        TradeRequest storage req = tradeRequests[requestId];

        require(listings[req.listingId].owner == msg.sender, "not listing owner");
        require(req.status == TradeStatus.PENDING,           "request not pending");

        req.status    = TradeStatus.REJECTED;
        req.updatedAt = block.timestamp;

        escrow.refund(requestEscrowId[requestId]);

        emit TradeRejected(requestId, req.listingId, msg.sender, block.timestamp);
    }

    // =========================================================================
    // ── SHIPPING, CONFIRMATION, RATINGS ───────────────────────────────────────
    // =========================================================================

    /**
     * @notice SELL/BUY only — the SELLER says the item has been sent (or handed over).
     *         `note` can hold a tracking number or other proof of delivery.
     *         Marking it shipped is what lets the seller raise a dispute if the
     *         buyer never confirms receipt.
     */
    function markShipped(uint256 requestId, string calldata note)
        external
        nonReentrant
        requestExists(requestId)
        onlyTradeParty(requestId)
    {
        TradeRequest storage req     = tradeRequests[requestId];
        Listing      storage listing = listings[req.listingId];

        require(listing.listingType != ListingType.BARTER, "only sell/buy trades ship");
        require(req.status == TradeStatus.IN_ESCROW,       "trade not in escrow");
        (, address seller) = _buyerSeller(listing, req);
        require(msg.sender == seller,                      "only the seller can ship");
        require(!req.shipped,                              "already marked shipped");
        require(bytes(note).length <= MAX_TEXT_LENGTH,     "note too long");

        req.shipped      = true;
        req.shippedAt    = block.timestamp;
        req.shippingNote = note;
        req.updatedAt    = block.timestamp;

        emit TradeShipped(requestId, msg.sender, note, block.timestamp);
    }

    /**
     * @notice Confirm that the exchange has taken place.
     *
     *         BARTER:   BOTH parties must call this. When both have, each side's
     *                   ETH deposit is returned and the rating window opens.
     *         SELL/BUY: only the BUYER calls this ("I received the item as
     *                   described"). The ETH is paid to the seller and the
     *                   rating window opens.
     *
     *         In every case the BTK stakes STAY LOCKED while both parties rate
     *         each other (rateCounterparty).
     */
    function confirmTradeCompletion(uint256 requestId)
        external
        nonReentrant
        requestExists(requestId)
        onlyTradeParty(requestId)
    {
        TradeRequest storage req     = tradeRequests[requestId];
        Listing      storage listing = listings[req.listingId];

        require(req.status == TradeStatus.IN_ESCROW, "trade not in escrow");

        if (listing.listingType != ListingType.BARTER) {
            (address buyer, ) = _buyerSeller(listing, req);
            require(msg.sender == buyer, "only the buyer confirms receipt");
        }

        if (msg.sender == listing.owner) {
            require(!req.ownerConfirmed, "owner already confirmed");
            req.ownerConfirmed = true;
        } else {
            require(!req.requesterConfirmed, "requester already confirmed");
            req.requesterConfirmed = true;
        }

        req.updatedAt = block.timestamp;

        emit TradeConfirmed(
            requestId, msg.sender,
            req.ownerConfirmed, req.requesterConfirmed,
            block.timestamp
        );

        // BARTER needs both; SELL/BUY needs only the buyer (who just confirmed).
        if (listing.listingType != ListingType.BARTER || (req.ownerConfirmed && req.requesterConfirmed)) {
            _confirmExchange(requestId, listing, req);
        }
    }

    /**
     * @notice Rate the other party in a trade whose exchange was confirmed.
     *
     *         `stars` (1–5) decides the bonus the OTHER party earns:
     *         5% of X x stars. Each party can rate once, and only until the
     *         rating window closes. When both have rated, the trade settles
     *         immediately: both stakes are returned and both bonuses minted.
     */
    function rateCounterparty(uint256 requestId, uint8 stars)
        external
        nonReentrant
        requestExists(requestId)
        onlyTradeParty(requestId)
    {
        require(stars >= 1 && stars <= MAX_STARS, "rating must be 1-5");

        TradeRequest storage req     = tradeRequests[requestId];
        Listing      storage listing = listings[req.listingId];

        require(req.status == TradeStatus.AWAITING_RATINGS, "trade not awaiting ratings");
        require(block.timestamp <= req.ratingDeadline,      "rating window closed");

        address rated;
        if (msg.sender == listing.owner) {
            require(req.ratingByOwner == 0, "already rated");
            req.ratingByOwner = stars;
            rated = req.requester;
        } else {
            require(req.ratingByRequester == 0, "already rated");
            req.ratingByRequester = stars;
            rated = listing.owner;
        }

        req.updatedAt = block.timestamp;

        emit TradeRated(requestId, msg.sender, rated, stars, block.timestamp);

        if (req.ratingByOwner != 0 && req.ratingByRequester != 0) {
            _finalizeTrade(requestId, listing, req);
        }
    }

    /**
     * @notice Settle a trade whose rating window has closed without both
     *         parties rating. Anyone may call this.
     *
     *         A party whose counterparty never rated receives the 5-star
     *         bonus (the same default the dispute rules use when someone
     *         gives no rating). Stakes are returned as normal.
     */
    function finalizeTrade(uint256 requestId)
        external
        nonReentrant
        requestExists(requestId)
    {
        TradeRequest storage req     = tradeRequests[requestId];
        Listing      storage listing = listings[req.listingId];

        require(req.status == TradeStatus.AWAITING_RATINGS, "trade not awaiting ratings");
        require(block.timestamp > req.ratingDeadline,       "rating window still open");

        _finalizeTrade(requestId, listing, req);
    }

    // =========================================================================
    // ── CALLING A TRADE OFF (both sides must agree) ───────────────────────────
    // =========================================================================

    /**
     * @notice Ask the other party to call an in-escrow trade off. Nothing moves
     *         until they agree (respondCancel). If they refuse or stay silent,
     *         raise a dispute instead. You can take your own proposal back with
     *         respondCancel(requestId, false).
     */
    function proposeCancel(uint256 requestId)
        external
        nonReentrant
        requestExists(requestId)
        onlyTradeParty(requestId)
    {
        TradeRequest storage req = tradeRequests[requestId];
        require(req.status == TradeStatus.IN_ESCROW,   "trade not in escrow");
        require(req.cancelProposedBy == address(0),    "cancellation already proposed");

        req.cancelProposedBy = msg.sender;
        req.updatedAt        = block.timestamp;

        emit CancelProposed(requestId, msg.sender, block.timestamp);
    }

    /**
     * @notice Answer a cancellation proposal (or take back your own).
     *         accept = true  → the OTHER party agrees: the trade is called off and
     *                          EVERYTHING locked is refunded to whoever locked it
     *                          (no bonus, no penalty);
     *         accept = false → the other party declines, or the proposer withdraws:
     *                          the proposal is dropped and the trade carries on.
     */
    function respondCancel(uint256 requestId, bool accept)
        external
        nonReentrant
        requestExists(requestId)
        onlyTradeParty(requestId)
    {
        TradeRequest storage req = tradeRequests[requestId];
        require(req.status == TradeStatus.IN_ESCROW, "trade not in escrow");
        require(req.cancelProposedBy != address(0),  "no cancellation proposed");

        bool byProposer = (req.cancelProposedBy == msg.sender);
        require(!(byProposer && accept), "cannot accept your own proposal");

        req.updatedAt = block.timestamp;

        if (!accept) {
            req.cancelProposedBy = address(0);
            emit CancelProposalCleared(requestId, msg.sender, !byProposer, block.timestamp);
            return;
        }

        // The listing itself stays open, so the owner can accept another request.
        req.status = TradeStatus.CANCELLED_IN_ESCROW;
        activeRequest[req.listingId] = 0;
        listings[req.listingId].updatedAt = block.timestamp;

        escrow.refund(requestEscrowId[requestId]);

        emit TradeCancelledInEscrow(requestId, req.listingId, block.timestamp);
    }

    // =========================================================================
    // ── DISPUTES ──────────────────────────────────────────────────────────────
    // =========================================================================

    /**
     * @notice Raise a dispute on a trade that is IN_ESCROW. The caller becomes the
     *         CLAIMANT; the admin investigates and calls resolveDispute().
     *
     *         BARTER:   either party, any kind.
     *         SELL/BUY: the BUYER (NOT_RECEIVED or NOT_AS_DESCRIBED) at any time, or
     *                   the SELLER (NOT_CONFIRMED) once it has marked the item shipped.
     *
     * @param kind    The claimant's category (the admin decides the outcome).
     * @param reason  The claimant's own words, for the admin and the history (<= 300 bytes).
     */
    function raiseDispute(uint256 requestId, DisputeKind kind, string calldata reason)
        external
        nonReentrant
        requestExists(requestId)
        onlyTradeParty(requestId)
    {
        TradeRequest storage req     = tradeRequests[requestId];
        Listing      storage listing = listings[req.listingId];

        require(req.status == TradeStatus.IN_ESCROW,   "trade not in escrow");
        require(bytes(reason).length <= MAX_TEXT_LENGTH, "reason too long");

        if (listing.listingType != ListingType.BARTER) {
            (address buyer, ) = _buyerSeller(listing, req);
            if (msg.sender == buyer) {
                require(kind != DisputeKind.NOT_CONFIRMED, "buyer: item missing or wrong");
            } else {
                require(kind == DisputeKind.NOT_CONFIRMED, "seller: buyer never confirmed");
                require(req.shipped,                       "mark the item as shipped first");
            }
        }

        req.status           = TradeStatus.DISPUTED;
        req.cancelProposedBy = address(0);
        req.updatedAt        = block.timestamp;

        Dispute storage d = disputes[requestId];
        d.requestId = requestId;
        d.raisedBy  = msg.sender;
        d.kind      = kind;
        d.reason    = reason;
        d.raisedAt  = block.timestamp;
        _disputeIds.push(requestId);

        emit TradeDisputed(requestId, req.listingId, msg.sender, kind, reason, block.timestamp);
    }

    /**
     * @notice Rule on a disputed trade (admin only).
     *
     *         BARTER     CLAIMANT_RIGHT  / CLAIMANT_LYING
     *         SELL / BUY SELLER_WINS / BUYER_WINS_MISSING / BUYER_WINS_NOT_AS_DESCRIBED
     *
     *         See the contract docs for exactly who gets what. For
     *         BUYER_WINS_NOT_AS_DESCRIBED nothing is released yet: the buyer has to
     *         return the item first (markReturned → confirmReturnReceived, or the
     *         admin closes it with adminCloseReturn).
     *
     * @dev    The winner is credited 5 stars where a bonus is paid, because the loser
     *         gives no rating. That default is not added to anyone's average rating.
     */
    function resolveDispute(uint256 requestId, Ruling ruling)
        external
        onlyOwner
        nonReentrant
        requestExists(requestId)
    {
        TradeRequest storage req     = tradeRequests[requestId];
        Listing      storage listing = listings[req.listingId];
        Dispute      storage d       = disputes[requestId];

        require(req.status == TradeStatus.DISPUTED, "not disputed");

        d.ruling     = ruling;
        d.resolvedAt = block.timestamp;
        uint256 x    = req.lockAmount;

        // ── BARTER ───────────────────────────────────────────────────────────
        if (listing.listingType == ListingType.BARTER) {
            require(
                ruling == Ruling.CLAIMANT_RIGHT || ruling == Ruling.CLAIMANT_LYING,
                "invalid ruling for a barter"
            );

            address claimant   = d.raisedBy;
            address respondent = (claimant == req.requester) ? listing.owner : req.requester;
            bool claimantIsRequester = (claimant == req.requester);
            Payout memory p;

            if (ruling == Ruling.CLAIMANT_RIGHT) {
                // The claimant takes ALL the ETH (2Y) and gets X back; the other side's X is burned.
                uint256 allEth = req.requesterEthLocked + req.ownerEthLocked;
                if (claimantIsRequester) { p.ethToRequester = allEth; p.btkToRequester = x; }
                else                     { p.ethToOwner     = allEth; p.btkToOwner     = x; }
                _closeDispute(requestId, req, listing, d, p, claimant, respondent, _bonus(x, MAX_STARS), x);
            } else {
                // Everyone gets their own X and Y back; the honest side also gets the 5-star bonus.
                p.ethToRequester = req.requesterEthLocked;
                p.ethToOwner     = req.ownerEthLocked;
                p.btkToRequester = x;
                p.btkToOwner     = x;
                _closeDispute(requestId, req, listing, d, p, respondent, claimant, _bonus(x, MAX_STARS), 0);
            }
            return;
        }

        // ── SELL / BUY ───────────────────────────────────────────────────────
        (address buyer, address seller) = _buyerSeller(listing, req);
        bool buyerIsRequester = (buyer == req.requester);

        if (ruling == Ruling.SELLER_WINS) {
            // Case 3 — the buyer's claim was false (or the buyer never confirmed): seller is paid.
            _closeDispute(
                requestId, req, listing, d,
                _sellBuyPayout(req, buyerIsRequester, false, x),
                seller, buyer, _bonus(x, MAX_STARS), 0
            );
        } else if (ruling == Ruling.BUYER_WINS_MISSING) {
            // Case 1 — the product never arrived: buyer made whole, 30% of the seller's X burned, no bonus.
            uint256 back = (x * (100 - MISSING_PENALTY_PERCENT)) / 100;
            _closeDispute(
                requestId, req, listing, d,
                _sellBuyPayout(req, buyerIsRequester, true, back),
                buyer, seller, 0, x - back
            );
        } else if (ruling == Ruling.BUYER_WINS_NOT_AS_DESCRIBED) {
            // Case 2 — the buyer must send the item back before anything is released.
            req.status    = TradeStatus.RETURN_PENDING;
            req.updatedAt = block.timestamp;
            d.winner      = buyer;
            d.loser       = seller;
            emit ReturnRequested(requestId, buyer, seller, block.timestamp);
        } else {
            revert("invalid ruling for a sell/buy");
        }
    }

    /**
     * @notice RETURN_PENDING — the buyer says the item is on its way back
     *         (`note` can hold the tracking number). Informational: the seller can
     *         confirm receipt either way.
     */
    function markReturned(uint256 requestId, string calldata note)
        external
        nonReentrant
        requestExists(requestId)
    {
        TradeRequest storage req = tradeRequests[requestId];
        Dispute      storage d   = disputes[requestId];

        require(req.status == TradeStatus.RETURN_PENDING, "no return is pending");
        require(msg.sender == d.winner,                   "only the buyer returns the item");
        require(d.returnedAt == 0,                        "already marked returned");
        require(bytes(note).length <= MAX_TEXT_LENGTH,    "note too long");

        d.returnNote = note;
        d.returnedAt = block.timestamp;
        req.updatedAt = block.timestamp;

        emit ReturnMarked(requestId, msg.sender, note, block.timestamp);
    }

    /**
     * @notice RETURN_PENDING — the seller confirms the item came back. This releases
     *         the escrow: buyer gets Y ETH + X BTK + the 5-star bonus; the seller
     *         gets 85% of X back (15% burned), no bonus.
     */
    function confirmReturnReceived(uint256 requestId)
        external
        nonReentrant
        requestExists(requestId)
    {
        require(tradeRequests[requestId].status == TradeStatus.RETURN_PENDING, "no return is pending");
        require(msg.sender == disputes[requestId].loser, "only the seller confirms return");

        disputes[requestId].returnResult = ReturnResult.CONFIRMED_BY_SELLER;
        _finishReturn(requestId, true);
    }

    /**
     * @notice RETURN_PENDING — admin only. Closes a return that is stuck:
     *         returnReceived = true  → treat the item as returned (same payout as the seller confirming);
     *         returnReceived = false → the item was never returned, so the buyer's claim
     *                                  does not stand: the seller is paid (SELLER_WINS payout).
     */
    function adminCloseReturn(uint256 requestId, bool returnReceived)
        external
        onlyOwner
        nonReentrant
        requestExists(requestId)
    {
        require(tradeRequests[requestId].status == TradeStatus.RETURN_PENDING, "no return is pending");

        disputes[requestId].returnResult = returnReceived ? ReturnResult.CONFIRMED_BY_ADMIN : ReturnResult.NOT_RETURNED;
        _finishReturn(requestId, returnReceived);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    /**
     * @dev The exchange is confirmed: release the ETH, close the listing and open
     *      the rating window. The BTK stakes remain in escrow.
     *        BARTER   each side's ETH deposit goes back to it.
     *        SELL/BUY all the ETH is paid to the seller.
     */
    function _confirmExchange(
        uint256 requestId,
        Listing storage listing,
        TradeRequest storage req
    ) internal {
        req.status           = TradeStatus.AWAITING_RATINGS;
        req.ratingDeadline   = block.timestamp + ratingWindow;
        req.cancelProposedBy = address(0);
        req.updatedAt        = block.timestamp;

        listing.active    = false;
        listing.updatedAt = block.timestamp;

        activeRequest[req.listingId] = 0;

        bytes32 escrowId = requestEscrowId[requestId];
        if (listing.listingType == ListingType.BARTER) {
            escrow.releaseEth(escrowId, req.requesterEthLocked, req.ownerEthLocked);
        } else {
            uint256 allEth = req.requesterEthLocked + req.ownerEthLocked;
            (, address seller) = _buyerSeller(listing, req);
            if (seller == req.requester) escrow.releaseEth(escrowId, allEth, 0);
            else                         escrow.releaseEth(escrowId, 0, allEth);
        }

        emit ExchangeConfirmed(requestId, req.listingId, req.ratingDeadline, block.timestamp);
    }

    /**
     * @dev Settle the BTK side of a normally-completed trade: return both
     *      stakes and mint each party 5% of X x the stars they received.
     *      A party whose counterparty never rated gets the 5-star default.
     */
    function _finalizeTrade(
        uint256 requestId,
        Listing storage listing,
        TradeRequest storage req
    ) internal {
        bool ownerWasRated     = req.ratingByRequester != 0;
        bool requesterWasRated = req.ratingByOwner != 0;

        uint8 starsForOwner     = ownerWasRated     ? req.ratingByRequester : MAX_STARS;
        uint8 starsForRequester = requesterWasRated ? req.ratingByOwner     : MAX_STARS;

        uint256 ownerBonus     = _bonus(req.lockAmount, starsForOwner);
        uint256 requesterBonus = _bonus(req.lockAmount, starsForRequester);

        req.status    = TradeStatus.COMPLETED;
        req.updatedAt = block.timestamp;

        // Principal: both stakes go back to their own owners.
        escrow.releaseTokens(requestEscrowId[requestId], req.lockAmount, req.lockAmount);

        // Bonuses are minted by Reputation. A failure there must never block
        // the settlement itself — the stakes above are already safe.
        if (address(reputation) != address(0)) {
            try reputation.recordSuccessfulTrade(listing.owner, starsForOwner, ownerWasRated, ownerBonus) {} catch {}
            try reputation.recordSuccessfulTrade(req.requester, starsForRequester, requesterWasRated, requesterBonus) {} catch {}
        }

        emit TradeCompleted(
            requestId, req.listingId, listing.owner, req.requester,
            starsForOwner, starsForRequester, ownerBonus, requesterBonus,
            block.timestamp
        );
    }

    /**
     * @dev The return step of a not-as-described ruling is over.
     *      returned  → Case 2 payout: buyer Y ETH + X + 5-star bonus; seller 85% of X (15% burned).
     *      !returned → the buyer's claim doesn't stand: SELLER_WINS payout.
     */
    function _finishReturn(uint256 requestId, bool returned) internal {
        TradeRequest storage req     = tradeRequests[requestId];
        Listing      storage listing = listings[req.listingId];
        Dispute      storage d       = disputes[requestId];

        (address buyer, address seller) = _buyerSeller(listing, req);
        bool buyerIsRequester = (buyer == req.requester);
        uint256 x = req.lockAmount;

        if (returned) {
            uint256 back = (x * (100 - NOT_AS_DESCRIBED_PENALTY_PERCENT)) / 100;
            _closeDispute(
                requestId, req, listing, d,
                _sellBuyPayout(req, buyerIsRequester, true, back),
                buyer, seller, _bonus(x, MAX_STARS), x - back
            );
        } else {
            _closeDispute(
                requestId, req, listing, d,
                _sellBuyPayout(req, buyerIsRequester, false, x),
                seller, buyer, _bonus(x, MAX_STARS), 0
            );
        }
    }

    /**
     * @dev SELL/BUY payout: the buyer always gets their own X back; all the ETH goes to
     *      the buyer (`ethToBuyer`) or to the seller; the seller gets `sellerBtk` back
     *      (whatever is not returned is burned by the Escrow).
     */
    function _sellBuyPayout(
        TradeRequest storage req,
        bool buyerIsRequester,
        bool ethToBuyer,
        uint256 sellerBtk
    ) internal view returns (Payout memory p) {
        uint256 allEth = req.requesterEthLocked + req.ownerEthLocked;
        if (buyerIsRequester) {
            p.btkToRequester = req.lockAmount;
            p.btkToOwner     = sellerBtk;
            if (ethToBuyer) p.ethToRequester = allEth; else p.ethToOwner = allEth;
        } else {
            p.btkToOwner     = req.lockAmount;
            p.btkToRequester = sellerBtk;
            if (ethToBuyer) p.ethToOwner = allEth; else p.ethToRequester = allEth;
        }
    }

    /**
     * @dev Final step of every dispute: close the listing, release the funds exactly as
     *      `p` says, record the outcome in the dispute and in Reputation, emit the event.
     */
    function _closeDispute(
        uint256 requestId,
        TradeRequest storage req,
        Listing storage listing,
        Dispute storage d,
        Payout memory p,
        address winner,
        address loser,
        uint256 winnerBonus,
        uint256 burned
    ) internal {
        req.status    = TradeStatus.RESOLVED;
        req.updatedAt = block.timestamp;

        listing.active    = false;
        listing.updatedAt = block.timestamp;
        activeRequest[req.listingId] = 0;

        d.winner      = winner;
        d.loser       = loser;
        d.winnerBonus = winnerBonus;
        d.burned      = burned;
        d.closedAt    = block.timestamp;

        bytes32 escrowId = requestEscrowId[requestId];
        escrow.releaseEth(escrowId, p.ethToRequester, p.ethToOwner);
        escrow.releaseTokens(escrowId, p.btkToRequester, p.btkToOwner);

        if (address(reputation) != address(0)) {
            try reputation.recordDisputeOutcome(d.raisedBy, winner, loser, winnerBonus, burned) {} catch {}
        }

        emit DisputeResolved(requestId, winner, loser, d.ruling, d.returnResult, winnerBonus, burned, block.timestamp);
    }

    /**
     * @dev When a request is accepted, reject all other PENDING requests on
     *      the same listing and refund their deposits automatically.
     *      Each refund is wrapped in try/catch so one failed transfer
     *      cannot prevent the acceptance from completing; a request is only
     *      marked REJECTED if its refund actually went through, so its funds
     *      are never left stranded behind a "rejected" label.
     */
    function _rejectOtherRequests(uint256 listingId, uint256 acceptedId) internal {
        uint256[] storage ids = _listingRequests[listingId];
        address listingOwner  = listings[listingId].owner;

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 reqId = ids[i];
            if (reqId == acceptedId) continue;

            TradeRequest storage other = tradeRequests[reqId];
            if (other.status != TradeStatus.PENDING) continue;

            try escrow.refund(requestEscrowId[reqId]) {
                other.status    = TradeStatus.REJECTED;
                other.updatedAt = block.timestamp;
                emit TradeRejected(reqId, listingId, listingOwner, block.timestamp);
            } catch {}
        }
    }

    // =========================================================================
    // View functions — frontend queries
    // =========================================================================

    /** @notice All listing IDs owned by a user. */
    function getUserListings(address user) external view returns (uint256[] memory) {
        return _userListings[user];
    }

    /** @notice All trade request IDs made BY a user (as requester). */
    function getUserRequests(address user) external view returns (uint256[] memory) {
        return _userRequests[user];
    }

    /** @notice All trade request IDs made ON a user's listings (as listing owner). */
    function getOwnerRequests(address user) external view returns (uint256[] memory) {
        return _ownerRequests[user];
    }

    /** @notice All trade request IDs submitted against a listing. */
    function getListingRequests(uint256 listingId) external view returns (uint256[] memory) {
        return _listingRequests[listingId];
    }

    /**
     * @notice Batch-fetch multiple listings by ID array.
     *         Use this in the frontend instead of looping single calls.
     */
    function getListingsBatch(uint256[] calldata ids)
        external
        view
        returns (Listing[] memory result)
    {
        result = new Listing[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = listings[ids[i]];
        }
    }

    /**
     * @notice Batch-fetch multiple trade requests by ID array.
     */
    function getRequestsBatch(uint256[] calldata ids)
        external
        view
        returns (TradeRequest[] memory result)
    {
        result = new TradeRequest[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = tradeRequests[ids[i]];
        }
    }

    /**
     * @notice Batch-fetch disputes by REQUEST id (a request that was never
     *         disputed comes back empty, with raisedBy = address(0)).
     */
    function getDisputesBatch(uint256[] calldata requestIds)
        external
        view
        returns (Dispute[] memory result)
    {
        result = new Dispute[](requestIds.length);
        for (uint256 i = 0; i < requestIds.length; i++) {
            result[i] = disputes[requestIds[i]];
        }
    }

    /** @notice The request id of every dispute ever raised, oldest first — the admin's history. */
    function getAllDisputeIds() external view returns (uint256[] memory) {
        return _disputeIds;
    }

    /** @notice How many disputes have ever been raised. */
    function totalDisputes() external view returns (uint256) {
        return _disputeIds.length;
    }

    /** @notice All listing IDs from 1 to the latest. Use for initial page load. */
    function getAllListingIds() external view returns (uint256[] memory ids) {
        uint256 count = nextListingId - 1;
        ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            ids[i] = i + 1;
        }
    }

    /** @notice All trade request IDs from 1 to the latest. */
    function getAllRequestIds() external view returns (uint256[] memory ids) {
        uint256 count = nextRequestId - 1;
        ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            ids[i] = i + 1;
        }
    }

    /** @notice Total listings ever created (including inactive). */
    function totalListings() external view returns (uint256) {
        return nextListingId - 1;
    }

    /** @notice Total trade requests ever created. */
    function totalRequests() external view returns (uint256) {
        return nextRequestId - 1;
    }
}
