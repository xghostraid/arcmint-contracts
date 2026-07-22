// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ICurvePoolView {
    function creator() external view returns (address);
    function graduated() external view returns (bool);
    function launchedAt() external view returns (uint256);
}

/// @title FeeRouter — collects platform + creator fees in USDC
/// @dev Creator fees vest until pool graduation (or fallback unlock delay).
contract FeeRouter is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    uint16 public platformTradeFeeBps = 100; // 1%
    uint16 public maxCreatorFeeBps = 500; // 5%
    uint16 public graduationFeeBps = 50; // 0.5%
    /// @dev If pool never graduates, creator can claim after this many seconds from launch
    uint32 public creatorFeeFallbackUnlock = 14 days;

    address public treasury;
    address public stakingRewards;

    address public factory;
    address public graduationMigrator;

    mapping(address => bool) public authorizedPools;
    /// @notice Total creator fees (all pools) — for UI
    mapping(address => uint256) public creatorFeesAccrued;
    /// @notice Per-pool creator fees (creator => pool => amount)
    mapping(address => mapping(address => uint256)) public creatorFeesByPool;

    uint256 public totalPlatformFees;

    event TradeFeesTaken(
        address indexed pool, uint256 platformFee, uint256 creatorFee, address indexed creator
    );
    event CreatorFeesClaimed(address indexed creator, address indexed pool, uint256 amount);
    event PoolAuthorized(address indexed pool, bool authorized);

    error Unauthorized();
    error InvalidBps();
    error FeesLocked();
    error NotCreator();

    constructor(address usdc_, address treasury_, address stakingRewards_) Ownable(msg.sender) {
        usdc = IERC20(usdc_);
        treasury = treasury_;
        stakingRewards = stakingRewards_;
    }

    function setFactory(address factory_) external onlyOwner {
        factory = factory_;
    }

    function setGraduationMigrator(address migrator_) external onlyOwner {
        graduationMigrator = migrator_;
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert Unauthorized();
        treasury = treasury_;
    }

    function setStakingRewards(address stakingRewards_) external onlyOwner {
        stakingRewards = stakingRewards_;
    }

    function setGraduationFeeBps(uint16 graduationFeeBps_) external onlyOwner {
        if (graduationFeeBps_ > 200) revert InvalidBps();
        graduationFeeBps = graduationFeeBps_;
    }

    function setCreatorFeeFallbackUnlock(uint32 seconds_) external onlyOwner {
        if (seconds_ < 1 days || seconds_ > 180 days) revert InvalidBps();
        creatorFeeFallbackUnlock = seconds_;
    }

    function setAuthorizedPool(address pool, bool authorized) external onlyOwner {
        authorizedPools[pool] = authorized;
        emit PoolAuthorized(pool, authorized);
    }

    function authorizePoolFromFactory(address pool) external {
        if (msg.sender != factory) revert Unauthorized();
        authorizedPools[pool] = true;
        emit PoolAuthorized(pool, true);
    }

    function setFeeConfig(uint16 platformTradeFeeBps_, uint16 maxCreatorFeeBps_) external onlyOwner {
        if (platformTradeFeeBps_ > 500 || maxCreatorFeeBps_ > 1000) revert InvalidBps();
        platformTradeFeeBps = platformTradeFeeBps_;
        maxCreatorFeeBps = maxCreatorFeeBps_;
    }

    /// @notice Deduct trade fees from USDC amount; pool must have approved this contract
    function takeTradeFees(
        address pool,
        address creator,
        uint16 creatorFeeBps,
        uint256 usdcAmount
    ) external returns (uint256 netAmount) {
        if (!authorizedPools[msg.sender]) revert Unauthorized();
        if (creatorFeeBps > maxCreatorFeeBps) creatorFeeBps = maxCreatorFeeBps;

        uint256 platformFee = (usdcAmount * platformTradeFeeBps) / 10_000;
        uint256 creatorFee = (usdcAmount * creatorFeeBps) / 10_000;
        netAmount = usdcAmount - platformFee - creatorFee;

        if (platformFee > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), platformFee);
            _distributePlatformFee(platformFee);
        }
        if (creatorFee > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), creatorFee);
            creatorFeesAccrued[creator] += creatorFee;
            creatorFeesByPool[creator][pool] += creatorFee;
        }

        emit TradeFeesTaken(pool, platformFee, creatorFee, creator);
    }

    /// @notice Deduct graduation fee from USDC held by GraduationMigrator
    function takeGraduationFee(address pool, uint256 usdcAmount) external returns (uint256 netAmount) {
        if (msg.sender != graduationMigrator) revert Unauthorized();
        uint256 fee = (usdcAmount * graduationFeeBps) / 10_000;
        netAmount = usdcAmount - fee;
        if (fee > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), fee);
            _distributePlatformFee(fee);
        }
        emit TradeFeesTaken(pool, fee, 0, address(0));
    }

    /// @notice Whether creator fees for a pool are claimable
    function creatorFeesUnlocked(address pool) public view returns (bool) {
        ICurvePoolView p = ICurvePoolView(pool);
        if (p.graduated()) return true;
        uint256 launched = p.launchedAt();
        if (launched == 0) return false;
        return block.timestamp >= launched + creatorFeeFallbackUnlock;
    }

    /// @notice Claim vested creator fees for one pool (after graduate or fallback unlock)
    function claimCreatorFeesForPool(address pool) external {
        if (ICurvePoolView(pool).creator() != msg.sender) revert NotCreator();
        if (!creatorFeesUnlocked(pool)) revert FeesLocked();

        uint256 amount = creatorFeesByPool[msg.sender][pool];
        if (amount == 0) return;

        creatorFeesByPool[msg.sender][pool] = 0;
        uint256 total = creatorFeesAccrued[msg.sender];
        creatorFeesAccrued[msg.sender] = total > amount ? total - amount : 0;

        usdc.safeTransfer(msg.sender, amount);
        emit CreatorFeesClaimed(msg.sender, pool, amount);
    }

    /// @notice Legacy entry: no-op if nothing claimable without pool context.
    /// @dev Prefer claimCreatorFeesForPool. Kept so old ABIs don't hard-fail.
    function claimCreatorFees() external {
        // Intentionally empty: fees are per-pool and must use claimCreatorFeesForPool.
        // Prevents accidental instant claim of unvested fees via old UI.
    }

    function _distributePlatformFee(uint256 fee) internal {
        totalPlatformFees += fee;
        uint256 toTreasury = (fee * 7000) / 10_000;
        uint256 toStakers = fee - toTreasury;
        if (toTreasury > 0) usdc.safeTransfer(treasury, toTreasury);
        if (toStakers > 0 && stakingRewards != address(0)) {
            usdc.safeTransfer(stakingRewards, toStakers);
        } else if (toStakers > 0) {
            usdc.safeTransfer(treasury, toStakers);
        }
    }
}
