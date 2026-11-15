// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @notice Minimal surface of BarterToken that other contracts need.
 */
interface IBarterToken {
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @notice Minimal surface of Escrow that BarterAgreement calls.
 *
 *         Every trade escrows native ETH and BTK from BOTH parties. Locking
 *         happens in two steps because ETH can only ever be pulled from
 *         whichever address actually sends the transaction:
 *
 *           1. requestTrade()       -> lockRequesterSide (requester's ETH + X BTK)
 *           2. acceptTradeRequest() -> lockOwnerSide     (owner's ETH + X BTK)
 *
 *         Settlement is split in two as well, because the ETH is released the
 *         moment a trade is confirmed, while the BTK stakes stay locked until
 *         the rating step (or a dispute ruling):
 *
 *           3. releaseEth()    -> pays out exactly what was locked, split as told
 *           4. releaseTokens() -> returns what it is told to, BURNS the rest
 *
 *         Both calls are checked by the Escrow: the ETH split must add up to
 *         exactly what was locked, and the BTK split can never exceed it.
 *
 *         refund() undoes everything for a request that never became a trade
 *         (cancelled / rejected), or that both sides agreed to call off.
 */
interface IEscrow {
    function lockRequesterSide(
        bytes32 barterID,
        address requester,
        address owner,
        uint256 tokenAmount
    ) external payable;

    function lockOwnerSide(bytes32 barterID, uint256 tokenAmount) external payable;

    function releaseEth(bytes32 barterID, uint256 toRequester, uint256 toOwner) external;
    function releaseTokens(bytes32 barterID, uint256 toRequester, uint256 toOwner) external;
    function refund(bytes32 barterID) external;
    function isActive(bytes32 barterID) external view returns (bool);
}

/**
 * @notice Minimal surface of Reputation that BarterAgreement calls.
 *
 *         Reputation is a ledger plus the contract that mints BTK bonuses.
 *         BarterAgreement decides WHAT each party earns (the rules live
 *         there); Reputation records it and mints it.
 */
interface IReputation {
    /// @notice A trade finished normally. `bonus` = 5% of the lock amount x stars received.
    /// @param wasRated  false when the counterparty never rated and the 5-star default applied.
    function recordSuccessfulTrade(
        address user,
        uint8   starsReceived,
        bool    wasRated,
        uint256 bonus
    ) external;

    /// @notice A dispute was ruled on by the admin.
    /// @param winnerBonus  5% of the lock amount x 5 stars, minted to the winner.
    /// @param loserSlashed BTK burned from the loser (0 when the loser only forfeits the bonus).
    function recordDisputeOutcome(
        address claimant,
        address winner,
        address loser,
        uint256 winnerBonus,
        uint256 loserSlashed
    ) external;
}
