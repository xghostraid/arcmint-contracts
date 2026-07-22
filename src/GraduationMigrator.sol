// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {BondingCurvePool} from "./BondingCurvePool.sol";
import {FeeRouter} from "./FeeRouter.sol";
import {ArcSwapRouter} from "./dex/ArcSwapRouter.sol";
import {LiquidityLocker} from "./LiquidityLocker.sol";

/// @title GraduationMigrator — migrates filled bonding curves to ArcSwap DEX
contract GraduationMigrator {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    FeeRouter public immutable feeRouter;
    ArcSwapRouter public immutable swapRouter;
    LiquidityLocker public immutable liquidityLocker;

    uint256 public constant DEFAULT_LOCK_DURATION = 30 days;

    address public factory;
    mapping(address => bool) public authorizedPools;

    event Graduated(
        address indexed pool,
        address indexed token,
        address indexed dexPair,
        uint256 usdcMigrated,
        uint256 tokensMigrated,
        uint256 lpLocked,
        uint256 lockId
    );

    error Unauthorized();
    error AlreadyGraduated();
    error CurveNotFull();

    constructor(address usdc_, address feeRouter_, address swapRouter_, address liquidityLocker_) {
        usdc = IERC20(usdc_);
        feeRouter = FeeRouter(feeRouter_);
        swapRouter = ArcSwapRouter(swapRouter_);
        liquidityLocker = LiquidityLocker(liquidityLocker_);
    }

    function setFactory(address factory_) external {
        if (factory != address(0)) revert Unauthorized();
        if (msg.sender != feeRouter.owner()) revert Unauthorized();
        factory = factory_;
    }

    function authorizePool(address pool, bool authorized) external {
        if (msg.sender != factory) revert Unauthorized();
        authorizedPools[pool] = authorized;
    }

    /// @notice Called by BondingCurvePool when the curve is fully sold
    function graduate(address pool) external returns (address dexPair) {
        if (!authorizedPools[pool]) revert Unauthorized();
        BondingCurvePool curve = BondingCurvePool(pool);
        if (curve.graduated()) revert AlreadyGraduated();
        if (curve.tokensSold() < curve.tokensForSale()) revert CurveNotFull();

        address token = address(curve.token());
        address creator = curve.creator();

        curve.pullAssetsForGraduation();

        uint256 usdcBal = usdc.balanceOf(address(this));
        uint256 tokenBal = IERC20(token).balanceOf(address(this));

        usdc.forceApprove(address(feeRouter), usdcBal);
        uint256 netUsdc = feeRouter.takeGraduationFee(pool, usdcBal);

        IERC20(token).forceApprove(address(swapRouter), tokenBal);
        usdc.forceApprove(address(swapRouter), netUsdc);

        (, , uint256 liquidity) = swapRouter.addLiquidity(
            token,
            address(usdc),
            tokenBal,
            netUsdc,
            0,
            0,
            address(this)
        );

        dexPair = _pairFor(token, address(usdc));

        uint256 unlockTime = curve.liquidityLocked() ? block.timestamp + DEFAULT_LOCK_DURATION : block.timestamp;
        IERC20(dexPair).forceApprove(address(liquidityLocker), liquidity);
        uint256 lockId = liquidityLocker.lock(dexPair, liquidity, creator, unlockTime);

        curve.markGraduated(dexPair);

        emit Graduated(pool, token, dexPair, netUsdc, tokenBal, liquidity, lockId);
    }

    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pair = swapRouter.factory().getPair(token0, token1);
    }
}