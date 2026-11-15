// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title  BarterToken (BTK)
 * @author Your Group Name
 * @notice Utility + reputation-stake token for the Decentralized Barter DApp.
 *
 *         Every wallet can claim a one-time 100 BTK starter grant via
 *         claimStarterTokens(). From there, BTK is what users lock as a
 *         mutual stake (X each) when they trade (see Escrow):
 *
 *           • Successful trade  → each party gets their X back PLUS a minted
 *                                 bonus of 5% of X per star the other party
 *                                 rated them (see BarterAgreement / Reputation).
 *           • Dispute           → the party ruled against by the admin either
 *                                 forfeits the bonus or, if their product was
 *                                 the problem, has their X burned.
 *
 *         There is no tiered badge system; a wallet's BTK balance and trade
 *         history speak for themselves.
 *
 * ─── Feature summary ──────────────────────────────────────────────────────
 *
 *  ERC-20 compliant   transfer / approve / allowance / transferFrom
 *  ERC20Burnable      burn()  — destroy your own tokens
 *                     burnFrom() — destroy tokens from another address
 *                                  using your allowance
 *  ERC20Permit        Gasless approvals via EIP-2612 signature.
 *                     Users sign off-chain; the Escrow calls
 *                     permit() + lock() in a single transaction.
 *  AccessControl      Role-based minting.
 *                     DEFAULT_ADMIN_ROLE  — can grant / revoke roles
 *                     MINTER_ROLE        — can call mint() (given to Reputation)
 *  Starter grant      claimStarterTokens() — 100 BTK, once per address.
 *  Hard supply cap    100 million BTK maximum, forever.
 *
 * ─── Deployment order ─────────────────────────────────────────────────────
 *
 *  1. Deploy BarterToken(deployerAddress)
 *  2. Deploy Escrow(barterTokenAddress, deployerAddress)
 *  3. Deploy BarterAgreement(barterTokenAddress, escrowAddress, deployerAddress)
 *  4. Deploy Reputation(barterTokenAddress, barterAgreementAddress, deployerAddress)
 *  5. Call escrow.setBarterAgreement(barterAgreementAddress)
 *  6. Call barterAgreement.setReputation(reputationAddress)
 *  7. Call barterToken.addMinter(reputationAddress)
 *     → Reputation can now mint rating-based rewards
 *
 * ─────────────────────────────────────────────────────────────────────────
 */
contract BarterToken is ERC20, ERC20Burnable, ERC20Permit, AccessControl {

    // =========================================================================
    // Roles
    // =========================================================================

    /**
     * @notice Accounts with this role can call mint().
     *         Grant it to the Reputation contract after deployment — it mints
     *         the trade bonuses.
     *         Revoke it before upgrading the Reputation contract to a new version.
     */
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // =========================================================================
    // Supply constants
    // =========================================================================

    /// @notice Absolute ceiling — no amount of minting can exceed this.
    uint256 public constant MAX_SUPPLY     = 100_000_000 * 10 ** 18;  // 100M BTK

    /// @notice Pre-minted to the deployer for initial distribution / liquidity.
    uint256 public constant INITIAL_SUPPLY =   1_000_000 * 10 ** 18;  // 1M BTK

    /// @notice One-time welcome grant every new wallet can claim for itself.
    uint256 public constant STARTER_TOKENS =         100 * 10 ** 18;  // 100 BTK

    // =========================================================================
    // Starter-grant tracking
    // =========================================================================

    /// @notice True once `account` has claimed its one-time starter grant.
    mapping(address => bool) public hasClaimedStarterTokens;

    // =========================================================================
    // Events
    // =========================================================================

    event TokensMinted        (address indexed to,     uint256 amount, address indexed minter);
    event TokensBurned        (address indexed from,   uint256 amount);
    event MinterAdded         (address indexed minter, address indexed admin);
    event MinterRemoved       (address indexed minter, address indexed admin);
    event StarterTokensClaimed(address indexed user,   uint256 amount);

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @param initialOwner  Receives DEFAULT_ADMIN_ROLE, MINTER_ROLE, and the
     *                      1 M BTK initial supply.
     *                      In production: use a multisig (e.g. Gnosis Safe).
     */
    constructor(address initialOwner)
        ERC20("BarterToken", "BTK")
        ERC20Permit("BarterToken")
    {
        require(initialOwner != address(0), "BarterToken: zero address");

        // Grant admin and minter roles to the deployer
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE,        initialOwner);

        // Mint the initial supply into the deployer's wallet
        _mint(initialOwner, INITIAL_SUPPLY);
    }

    // =========================================================================
    // Minting
    // =========================================================================

    /**
     * @notice Create new BTK tokens and send them to `to`.
     *
     *         Who calls this?
     *          - The Reputation contract (after being granted MINTER_ROLE)
     *            mints the trade bonus (5% of the lock amount x stars) to a
     *            user when a trade settles, or to the winner of a dispute.
     *          - The admin can also mint directly for marketing / airdrops.
     *
     * @param to     Recipient address.
     * @param amount Amount in BTK-wei (1 BTK = 1e18 BTK-wei).
     *
     * @dev  Reverts if the cap would be breached — Reputation wraps this in
     *       a try/catch so a near-capped supply never blocks a rating.
     */
    function mint(address to, uint256 amount)
        external
        onlyRole(MINTER_ROLE)
    {
        require(to     != address(0),               "BarterToken: mint to zero address");
        require(amount  > 0,                        "BarterToken: amount must be > 0");
        require(totalSupply() + amount <= MAX_SUPPLY, "BarterToken: exceeds max supply");

        _mint(to, amount);
        emit TokensMinted(to, amount, msg.sender);
    }

    // =========================================================================
    // Starter grant
    // =========================================================================

    /**
     * @notice Claim your one-time 100 BTK starting balance.
     *
     *         This is what every new user's reputation-stake balance is
     *         bootstrapped from — call it right after connecting a wallet
     *         for the first time. Reverts if this address has already
     *         claimed it; each address can only ever do this once.
     */
    function claimStarterTokens() external {
        require(!hasClaimedStarterTokens[msg.sender], "BarterToken: starter tokens already claimed");
        require(totalSupply() + STARTER_TOKENS <= MAX_SUPPLY, "BarterToken: exceeds max supply");

        hasClaimedStarterTokens[msg.sender] = true;
        _mint(msg.sender, STARTER_TOKENS);

        emit StarterTokensClaimed(msg.sender, STARTER_TOKENS);
    }

    // =========================================================================
    // Burn overrides
    // (ERC20Burnable already has the logic; we override only to emit our event)
    // =========================================================================

    /**
     * @notice Burn tokens from the caller's own balance.
     *
     *         Use case: a user wants to reduce their holdings, or the Escrow
     *         contract burns the locked stake of a party the admin ruled
     *         against in a dispute (the penalty for a product that was not
     *         as described / not received).
     *
     * @param amount Amount in BTK-wei.
     */
    function burn(uint256 amount) public override {
        super.burn(amount);
        emit TokensBurned(msg.sender, amount);
    }

    /**
     * @notice Burn `amount` tokens from `account` using the caller's allowance.
     *
     *         Use case: burning someone's tokens with their prior approval.
     *         (Dispute penalties do not need this — the Escrow already holds
     *         the locked stake and burns it directly with burn().)
     *
     *         EIP-2612 tip: combine with `permit()` to do it in one tx:
     *           permit(owner, spender, value, deadline, v, r, s)
     *           burnFrom(owner, value)
     *
     * @param account Address whose tokens will be burned.
     * @param amount  Amount in BTK-wei.
     */
    function burnFrom(address account, uint256 amount) public override {
        super.burnFrom(account, amount);
        emit TokensBurned(account, amount);
    }

    // =========================================================================
    // Role management helpers
    // =========================================================================

    /**
     * @notice Grant MINTER_ROLE to `minter` (typically the Reputation contract).
     *         Only callable by DEFAULT_ADMIN_ROLE.
     *
     * @dev    Deploy order reminder:
     *          barterToken.addMinter(reputationAddress)  — call this after
     *          Reputation is deployed so it can mint rating rewards.
     */
    function addMinter(address minter)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(minter != address(0), "BarterToken: zero address");
        _grantRole(MINTER_ROLE, minter);
        emit MinterAdded(minter, msg.sender);
    }

    /**
     * @notice Revoke MINTER_ROLE from `minter`.
     *         Call this before upgrading the Escrow contract to a new address.
     */
    function removeMinter(address minter)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _revokeRole(MINTER_ROLE, minter);
        emit MinterRemoved(minter, msg.sender);
    }

    // =========================================================================
    // View helpers
    // =========================================================================

    /**
     * @notice How many BTK can still be minted before hitting the hard cap.
     *         Useful for the frontend to display "remaining supply".
     */
    function remainingMintable() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

    /**
     * @notice Returns true if `account` holds MINTER_ROLE.
     *         Use this in your frontend to verify the Escrow was set up correctly.
     */
    function isMinter(address account) external view returns (bool) {
        return hasRole(MINTER_ROLE, account);
    }
}
