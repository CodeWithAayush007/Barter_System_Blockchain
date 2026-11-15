// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IBarterPlatform.sol";

/**
 * @title  Reputation
 * @author Your Group Name
 * @notice The on-chain trust ledger of the Decentralized Barter Platform, and
 *         the only contract allowed to mint BTK bonuses.
 *
 *         BarterAgreement owns the barter RULES (who earns what, who is
 *         penalised); this contract records the outcome of those rules per
 *         wallet and mints the bonus tokens. Nothing here can be called by
 *         users directly — every write comes from BarterAgreement, so a
 *         wallet's record can only change as the result of a real trade.
 *
 * ─── What is tracked per wallet ───────────────────────────────────────────
 *
 *   completedTrades   trades that finished normally (both confirmed + rated /
 *                     rating window closed)
 *   ratingCount /     stars actually GIVEN BY a counterparty. A default
 *   average rating    5-star bonus (nobody rated) is paid but NOT counted here.
 *   tokensEarned      lifetime BTK bonuses minted to this wallet
 *   disputesRaised    disputes this wallet opened that the admin has ruled on
 *   disputesWon /     rulings in this wallet's favour / against it
 *   disputesLost
 *   tokensSlashed     lifetime BTK burned from this wallet by a ruling
 *
 * ─── Bonus rule (see BarterAgreement for where it is computed) ────────────
 *
 *   bonus = 5% of the lock amount X  x  stars received (1–5)
 *
 *   e.g. X = 100 BTK, rated 4 stars  →  100 x 5% x 4 = 20 BTK bonus
 *
 * ─────────────────────────────────────────────────────────────────────────
 */
contract Reputation is Ownable {

    // =========================================================================
    // Types
    // =========================================================================

    struct UserScore {
        uint256 completedTrades;   // trades finished normally
        uint256 totalRatingPoints; // sum of explicit 1-5 ratings received
        uint256 ratingCount;       // number of explicit ratings received
        uint256 tokensEarned;      // lifetime BTK minted to this user as bonuses
        uint256 tokensSlashed;     // lifetime BTK burned from this user by dispute rulings
        uint256 disputesRaised;    // disputes this user opened (counted once ruled on)
        uint256 disputesWon;       // rulings in this user's favour
        uint256 disputesLost;      // rulings against this user
        uint256 firstTradeAt;      // timestamp of first completed trade
        uint256 lastTradeAt;       // timestamp of most recent completed trade
    }

    // =========================================================================
    // State
    // =========================================================================

    /// @notice The BTK token — Reputation must hold MINTER_ROLE on it to pay bonuses.
    IBarterToken public immutable barterToken;

    /// @notice Only BarterAgreement may write to this contract.
    address public barterAgreement;

    mapping(address => UserScore) public scores;

    // =========================================================================
    // Events
    // =========================================================================

    event TradeRecorded(
        address indexed user,
        uint8   starsReceived,
        bool    wasRated,
        uint256 bonus,
        uint256 timestamp
    );

    event DisputeRecorded(
        address indexed claimant,
        address indexed winner,
        address indexed loser,
        uint256 winnerBonus,
        uint256 loserSlashed,
        uint256 timestamp
    );

    event BonusPaid(address indexed user, uint256 amount);

    /// @notice Emitted instead of reverting when the bonus mint fails
    ///         (e.g. MAX_SUPPLY reached or this contract lost MINTER_ROLE) —
    ///         the trade outcome itself still stands.
    event RewardMintFailed(address indexed user, uint256 attemptedAmount);

    event BarterAgreementSet(address indexed barterAgreement);

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyBarterAgreement() {
        require(msg.sender == barterAgreement, "Reputation: caller not BarterAgreement");
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @param _barterToken      Address of the deployed BarterToken contract.
     *                          Reputation must be granted MINTER_ROLE on it
     *                          (barterToken.addMinter(reputationAddress)) for
     *                          bonuses to actually mint.
     * @param _barterAgreement  Address of the BarterAgreement contract.
     *                          Can also be set afterwards with setBarterAgreement().
     * @param initialOwner      Admin for this contract.
     */
    constructor(address _barterToken, address _barterAgreement, address initialOwner)
        Ownable(initialOwner)
    {
        require(_barterToken != address(0), "Reputation: zero token");
        require(initialOwner != address(0), "Reputation: zero owner");

        barterToken = IBarterToken(_barterToken);
        if (_barterAgreement != address(0)) {
            barterAgreement = _barterAgreement;
        }
    }

    // =========================================================================
    // Setup
    // =========================================================================

    /**
     * @notice Set or update the authorised BarterAgreement address.
     *         Only callable by the contract owner.
     */
    function setBarterAgreement(address _barterAgreement) external onlyOwner {
        require(_barterAgreement != address(0), "Reputation: zero address");
        barterAgreement = _barterAgreement;
        emit BarterAgreementSet(_barterAgreement);
    }

    // =========================================================================
    // Called by BarterAgreement
    // =========================================================================

    /**
     * @notice A trade finished normally. Updates the wallet's record and mints
     *         its bonus. Called once per party.
     *
     * @param user          The wallet being credited.
     * @param starsReceived Stars the wallet earned (1–5). If the counterparty
     *                      never rated this is the 5-star default.
     * @param wasRated      true if `starsReceived` is a real rating from the
     *                      counterparty; false if it is the default.
     * @param bonus         BTK-wei to mint (5% x lock amount x starsReceived).
     */
    function recordSuccessfulTrade(
        address user,
        uint8   starsReceived,
        bool    wasRated,
        uint256 bonus
    ) external onlyBarterAgreement {
        require(user != address(0), "Reputation: zero address");

        UserScore storage s = scores[user];
        uint256 ts = block.timestamp;

        s.completedTrades++;
        s.lastTradeAt = ts;
        if (s.firstTradeAt == 0) s.firstTradeAt = ts;

        if (wasRated) {
            s.totalRatingPoints += starsReceived;
            s.ratingCount++;
        }

        _payBonus(s, user, bonus);

        emit TradeRecorded(user, starsReceived, wasRated, bonus, ts);
    }

    /**
     * @notice The admin ruled on a dispute. Credits the winner's bonus and
     *         records the loss (and any burned BTK) against the loser.
     *
     * @param claimant     The wallet that raised the dispute.
     * @param winner       The wallet the admin ruled for.
     * @param loser        The wallet the admin ruled against.
     * @param winnerBonus  BTK-wei minted to the winner (5% x lock amount x 5 stars).
     * @param loserSlashed BTK-wei that was burned from the loser's stake (0 if none).
     */
    function recordDisputeOutcome(
        address claimant,
        address winner,
        address loser,
        uint256 winnerBonus,
        uint256 loserSlashed
    ) external onlyBarterAgreement {
        require(
            claimant != address(0) && winner != address(0) && loser != address(0),
            "Reputation: zero address"
        );

        scores[claimant].disputesRaised++;

        UserScore storage w = scores[winner];
        w.disputesWon++;
        _payBonus(w, winner, winnerBonus);

        UserScore storage l = scores[loser];
        l.disputesLost++;
        l.tokensSlashed += loserSlashed;

        emit DisputeRecorded(claimant, winner, loser, winnerBonus, loserSlashed, block.timestamp);
    }

    // =========================================================================
    // Internal
    // =========================================================================

    /// @dev Mints `amount` BTK to `user`. A failed mint (supply cap, missing
    ///      MINTER_ROLE) is reported via an event instead of reverting, so a
    ///      bonus problem can never block a trade from settling.
    function _payBonus(UserScore storage s, address user, uint256 amount) internal {
        if (amount == 0) return;
        try barterToken.mint(user, amount) {
            s.tokensEarned += amount;
            emit BonusPaid(user, amount);
        } catch {
            emit RewardMintFailed(user, amount);
        }
    }

    // =========================================================================
    // View functions
    // =========================================================================

    /**
     * @notice Full reputation snapshot for a user — just the numbers, no tiers.
     *
     * @return completedTradeCount Number of trades finished normally.
     * @return averageRating       Average rating x 100 (2 decimal places without
     *                             floats — divide by 100 in the frontend).
     *                             e.g. 450 → 4.50 stars. 0 if never rated.
     * @return ratingCount         How many explicit ratings have been received.
     * @return tokensEarned        Lifetime BTK minted to this user as bonuses.
     * @return firstTradeAt        Unix timestamp of first completed trade (0 if none).
     * @return lastTradeAt         Unix timestamp of most recent completed trade.
     */
    function getReputation(address user)
        external
        view
        returns (
            uint256 completedTradeCount,
            uint256 averageRating,
            uint256 ratingCount,
            uint256 tokensEarned,
            uint256 firstTradeAt,
            uint256 lastTradeAt
        )
    {
        UserScore storage s = scores[user];

        completedTradeCount = s.completedTrades;
        ratingCount          = s.ratingCount;
        tokensEarned         = s.tokensEarned;
        firstTradeAt         = s.firstTradeAt;
        lastTradeAt          = s.lastTradeAt;

        averageRating = (s.ratingCount > 0)
            ? (s.totalRatingPoints * 100) / s.ratingCount
            : 0;
    }

    /**
     * @notice A wallet's dispute and penalty history.
     *
     * @return raised        Disputes this wallet opened (that have been ruled on).
     * @return won           Rulings in this wallet's favour.
     * @return lost          Rulings against this wallet.
     * @return tokensSlashed Lifetime BTK burned from this wallet by rulings.
     */
    function getDisputeRecord(address user)
        external
        view
        returns (uint256 raised, uint256 won, uint256 lost, uint256 tokensSlashed)
    {
        UserScore storage s = scores[user];
        return (s.disputesRaised, s.disputesWon, s.disputesLost, s.tokensSlashed);
    }
}
