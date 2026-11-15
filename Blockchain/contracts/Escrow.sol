// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IBarterPlatform.sol";

/**
 * @title  Escrow
 * @author Your Group Name
 * @notice Holds BOTH native ETH and BTK tokens in safe custody during an
 *         active trade, from BOTH parties.
 *
 * ─── What gets locked ─────────────────────────────────────────────────────
 *
 *  BTK    Both parties lock the SAME amount, X BTK. X is set by the listing
 *         owner when the listing is created (see BarterAgreement). Total
 *         BTK held for one trade = 2X.
 *
 *  ETH    Every listing has an ETH amount Y, set by the listing owner:
 *           SELL   the buyer (the requester) locks Y; the seller locks no ETH
 *           BUY    the buyer (the listing owner) locks Y; the seller locks no ETH
 *           BARTER BOTH parties lock Y (each side's ETH is a deposit, not a payment)
 *
 * ─── State machine for each barterID ──────────────────────────────────────
 *
 *   None ──lockRequesterSide()──► AwaitingCounterparty ──lockOwnerSide()──► Active
 *                                        │                                    │
 *                                     refund()                            releaseEth()
 *                                        │                                    │
 *                                        ▼                                    ▼
 *                                    Refunded                             EthSettled
 *                                                                             │
 *                                                                        releaseTokens()
 *                                                                             │
 *                                                                             ▼
 *                                                                          Released
 *
 *  Settlement is deliberately two steps:
 *
 *   releaseEth     runs the moment the exchange is confirmed (or the admin rules
 *                  on a dispute). BarterAgreement says how much of the locked
 *                  ETH goes to each party; the amounts must add up to exactly
 *                  what is held.
 *   releaseTokens  runs once ratings are in (or the rating window lapses, or
 *                  the admin rules on a dispute). BarterAgreement says how
 *                  much BTK goes back to each party; whatever is NOT returned
 *                  is BURNED (the penalty). The bonus on top of the returned
 *                  stake is minted separately by Reputation.
 *
 * ─── Interaction pattern (called by BarterAgreement) ──────────────────────
 *
 *  Requester side — on requestTrade():
 *    1. Requester calls barterToken.approve(escrowAddress, X)
 *    2. BarterAgreement.requestTrade{value: requesterEth}(...)
 *       → escrow.lockRequesterSide{value: requesterEth}(barterID, requester, owner, X)
 *
 *  Owner side — on acceptTradeRequest():
 *    3. Owner calls barterToken.approve(escrowAddress, X)
 *    4. BarterAgreement.acceptTradeRequest{value: ownerEth}(...)
 *       → escrow.lockOwnerSide{value: ownerEth}(barterID, X)
 *
 *  Cancellation / rejection (before the owner locked, or never accepted):
 *    5. escrow.refund(barterID) — everything locked so far goes back.
 *
 * ─── Security notes ───────────────────────────────────────────────────────
 *
 *  • ReentrancyGuard on every function that moves funds
 *  • SafeERC20 for all BTK transfers
 *  • onlyBarterAgreement modifier — Escrow cannot be called directly by users
 *  • ETH is pushed with a low-level call; if that ever fails (e.g. the
 *    recipient is a contract wallet with no payable receive/fallback), the
 *    amount is credited to pendingWithdrawals instead of reverting the
 *    whole settlement, and the recipient can pull it later with withdraw().
 *
 * ─────────────────────────────────────────────────────────────────────────
 */
contract Escrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // =========================================================================
    // State
    // =========================================================================

    IERC20 public immutable barterToken;

    /// @notice Only the BarterAgreement contract may call lock / release / refund.
    ///         Set once via setBarterAgreement() after deployment.
    address public barterAgreement;

    // =========================================================================
    // Escrow record
    // =========================================================================

    enum Status { None, AwaitingCounterparty, Active, EthSettled, Released, Refunded }

    struct EscrowRecord {
        address requester;      // the trade requester
        address owner;          // the listing owner
        uint256 requesterEth;   // ETH locked by the requester
        uint256 ownerEth;       // ETH locked by the owner
        uint256 requesterToken; // BTK locked by the requester (X)
        uint256 ownerToken;     // BTK locked by the owner (X)
        Status  status;
        uint256 lockedAt;       // block.timestamp of the requester's lock
    }

    /// @dev barterID → record. barterID is generated by BarterAgreement.
    mapping(bytes32 => EscrowRecord) public records;

    /// @notice ETH that failed to push to its recipient — pull it with withdraw().
    mapping(address => uint256) public pendingWithdrawals;

    // =========================================================================
    // Events
    // =========================================================================

    event RequesterLocked(bytes32 indexed barterID, address indexed requester, address indexed owner, uint256 ethAmount, uint256 tokenAmount);
    event OwnerLocked     (bytes32 indexed barterID, address indexed owner, uint256 ethAmount, uint256 tokenAmount);
    event EthReleased     (bytes32 indexed barterID, uint256 toRequester, uint256 toOwner);
    /// @param burned BTK destroyed as a penalty (locked BTK that was not returned to anyone).
    event TokensReleased  (bytes32 indexed barterID, uint256 toRequester, uint256 toOwner, uint256 burned);
    event Refunded        (bytes32 indexed barterID, uint256 requesterEth, uint256 ownerEth, uint256 requesterToken, uint256 ownerToken);
    event WithdrawalCredited(address indexed to, uint256 amount);
    event Withdrawn         (address indexed to, uint256 amount);
    event BarterAgreementSet(address indexed barterAgreement);

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyBarterAgreement() {
        require(
            msg.sender == barterAgreement,
            "Escrow: caller is not BarterAgreement"
        );
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @param tokenAddress  Address of the deployed BarterToken contract.
     * @param initialOwner  Receives Ownable admin rights (setBarterAgreement).
     */
    constructor(address tokenAddress, address initialOwner)
        Ownable(initialOwner)
    {
        require(tokenAddress != address(0), "Escrow: zero token address");
        require(initialOwner != address(0), "Escrow: zero owner address");
        barterToken = IERC20(tokenAddress);
    }

    // =========================================================================
    // One-time setup
    // =========================================================================

    /**
     * @notice Link this Escrow to the BarterAgreement contract.
     *         Call once after deploying BarterAgreement. The link can never be
     *         changed afterwards, so nobody — the admin included — can re-point
     *         the Escrow at a different contract and pull users' funds out.
     */
    function setBarterAgreement(address _barterAgreement)
        external
        onlyOwner
    {
        require(barterAgreement == address(0), "Escrow: BarterAgreement already set");
        require(_barterAgreement != address(0), "Escrow: zero address");
        barterAgreement = _barterAgreement;
        emit BarterAgreementSet(_barterAgreement);
    }

    // =========================================================================
    // Locking
    // =========================================================================

    /**
     * @notice Lock the requester's side of a trade: their ETH (msg.value)
     *         plus X BTK.
     *
     *         Called by BarterAgreement from within requestTrade(). The
     *         requester MUST have called barterToken.approve(escrow, tokenAmount)
     *         beforehand — Escrow pulls the BTK using that allowance.
     *
     * @param barterID    Unique bytes32 ID for this trade.
     * @param requester   Address whose ETH/BTK is being locked.
     * @param owner       The listing owner — the other party in this trade.
     * @param tokenAmount X, in BTK-wei.
     */
    function lockRequesterSide(
        bytes32 barterID,
        address requester,
        address owner,
        uint256 tokenAmount
    )
        external
        payable
        onlyBarterAgreement
    {
        require(records[barterID].status == Status.None, "Escrow: barterID exists");
        require(requester != address(0), "Escrow: zero requester");
        require(owner     != address(0), "Escrow: zero owner");
        require(requester != owner,      "Escrow: same parties");

        records[barterID] = EscrowRecord({
            requester     : requester,
            owner         : owner,
            requesterEth  : msg.value,
            ownerEth      : 0,
            requesterToken: tokenAmount,
            ownerToken    : 0,
            status        : Status.AwaitingCounterparty,
            lockedAt      : block.timestamp
        });

        if (tokenAmount > 0) {
            barterToken.safeTransferFrom(requester, address(this), tokenAmount);
        }

        emit RequesterLocked(barterID, requester, owner, msg.value, tokenAmount);
    }

    /**
     * @notice Lock the listing owner's side of a trade: their ETH
     *         (msg.value) plus the same X BTK the requester locked.
     *
     *         Called by BarterAgreement from within acceptTradeRequest().
     *         The owner MUST have called barterToken.approve(escrow, tokenAmount)
     *         beforehand.
     *
     * @param barterID    The trade's escrow ID — must already be AwaitingCounterparty.
     * @param tokenAmount X, in BTK-wei.
     */
    function lockOwnerSide(bytes32 barterID, uint256 tokenAmount)
        external
        payable
        onlyBarterAgreement
    {
        EscrowRecord storage rec = records[barterID];
        require(rec.status == Status.AwaitingCounterparty, "Escrow: not awaiting owner");

        rec.ownerEth   = msg.value;
        rec.ownerToken = tokenAmount;
        rec.status     = Status.Active;

        if (tokenAmount > 0) {
            barterToken.safeTransferFrom(rec.owner, address(this), tokenAmount);
        }

        emit OwnerLocked(barterID, rec.owner, msg.value, tokenAmount);
    }

    // =========================================================================
    // Settlement
    // =========================================================================

    /**
     * @notice Release the ETH half of a trade. BTK is untouched and stays
     *         locked until releaseTokens().
     *
     * @param toRequester ETH sent to the requester.
     * @param toOwner     ETH sent to the listing owner.
     *
     * @dev  The two amounts must add up to EXACTLY the ETH held for this trade,
     *       so a ruling can move the ETH around but never create or lose any.
     *       Checks-effects-interactions: status is updated before any ETH moves.
     */
    function releaseEth(bytes32 barterID, uint256 toRequester, uint256 toOwner)
        external
        onlyBarterAgreement
        nonReentrant
    {
        EscrowRecord storage rec = records[barterID];
        require(rec.status == Status.Active, "Escrow: not active");
        require(
            toRequester + toOwner == rec.requesterEth + rec.ownerEth,
            "Escrow: ETH split must equal the amount held"
        );

        address requester = rec.requester;
        address owner     = rec.owner;

        rec.status = Status.EthSettled;

        _sendEth(requester, toRequester);
        _sendEth(owner,     toOwner);

        emit EthReleased(barterID, toRequester, toOwner);
    }

    /**
     * @notice Release the BTK half of a trade. Each party gets back the amount
     *         BarterAgreement names; the rest of the locked BTK is BURNED.
     *
     *         BTK that is burned is gone for good (total supply shrinks) — it
     *         is NOT handed to the other party. Bonuses are never paid from
     *         here; Reputation mints them.
     *
     * @param toRequester BTK returned to the requester (at most what they locked).
     * @param toOwner     BTK returned to the listing owner (at most what they locked).
     */
    function releaseTokens(bytes32 barterID, uint256 toRequester, uint256 toOwner)
        external
        onlyBarterAgreement
        nonReentrant
    {
        EscrowRecord storage rec = records[barterID];
        require(rec.status == Status.EthSettled, "Escrow: eth not settled");
        require(toRequester <= rec.requesterToken, "Escrow: more than the requester locked");
        require(toOwner     <= rec.ownerToken,     "Escrow: more than the owner locked");

        address requester = rec.requester;
        address owner     = rec.owner;
        uint256 burned    = (rec.requesterToken - toRequester) + (rec.ownerToken - toOwner);

        rec.status = Status.Released;

        if (toRequester > 0) barterToken.safeTransfer(requester, toRequester);
        if (toOwner     > 0) barterToken.safeTransfer(owner,     toOwner);
        if (burned      > 0) IBarterToken(address(barterToken)).burn(burned);

        emit TokensReleased(barterID, toRequester, toOwner, burned);
    }

    /**
     * @notice Return everything locked so far to whoever locked it.
     *         Works whether only the requester has locked (AwaitingCounterparty)
     *         or both parties have (Active).
     *
     *         Called by BarterAgreement on cancellation or rejection, when the
     *         owner accepts a different request, and when both parties agree to
     *         call off a trade that was already fully locked.
     */
    function refund(bytes32 barterID)
        external
        onlyBarterAgreement
        nonReentrant
    {
        EscrowRecord storage rec = records[barterID];
        require(
            rec.status == Status.AwaitingCounterparty || rec.status == Status.Active,
            "Escrow: not active"
        );

        address requester      = rec.requester;
        address owner          = rec.owner;
        uint256 requesterEth   = rec.requesterEth;
        uint256 ownerEth       = rec.ownerEth;
        uint256 requesterToken = rec.requesterToken;
        uint256 ownerToken     = rec.ownerToken;

        rec.status = Status.Refunded;

        _sendEth(requester, requesterEth);
        if (requesterToken > 0) barterToken.safeTransfer(requester, requesterToken);

        // The owner side may never have locked at all (still AwaitingCounterparty) —
        // these are simply 0 in that case, so the sends below are no-ops.
        if (ownerEth   > 0) _sendEth(owner, ownerEth);
        if (ownerToken > 0) barterToken.safeTransfer(owner, ownerToken);

        emit Refunded(barterID, requesterEth, ownerEth, requesterToken, ownerToken);
    }

    // =========================================================================
    // ETH transfer helper + pull-payment safety net
    // =========================================================================

    /// @dev Push ETH to `to`; on failure, credit it to pendingWithdrawals
    ///      instead of reverting, so one bad recipient can't freeze a settlement.
    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) {
            pendingWithdrawals[to] += amount;
            emit WithdrawalCredited(to, amount);
        }
    }

    /// @notice Pull any ETH that couldn't be pushed to you automatically.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Escrow: nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Escrow: withdrawal failed");

        emit Withdrawn(msg.sender, amount);
    }

    // =========================================================================
    // View helpers (useful for frontend)
    // =========================================================================

    function getRecord(bytes32 barterID)
        external
        view
        returns (EscrowRecord memory)
    {
        return records[barterID];
    }

    function isActive(bytes32 barterID) external view returns (bool) {
        return records[barterID].status == Status.Active;
    }

    function getStatus(bytes32 barterID) external view returns (Status) {
        return records[barterID].status;
    }

    // Reject stray direct ETH transfers — every deposit must go through
    // lockRequesterSide / lockOwnerSide so it's properly accounted for.
    receive() external payable {
        revert("Escrow: direct ETH transfers not accepted");
    }
}
