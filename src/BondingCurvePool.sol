// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FeeRouter} from "./FeeRouter.sol";
import {ArcToken} from "./ArcToken.sol";
import {GraduationMigrator} from "./GraduationMigrator.sol";

/// @title BondingCurvePool — constant-product bonding curve + anti-rug guards
contract BondingCurvePool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum CurveType {
        LINEAR_VIRTUAL,
        EXPONENTIAL_VIRTUAL
    }

    struct InitParams {
        address token;
        address usdc;
        address feeRouter;
        address graduationMigrator;
        address creator;
        uint16 creatorFeeBps;
        uint256 virtualUsdcReserve; // 6 decimals
        uint256 virtualTokenReserve; // 18 decimals
        uint256 tokensForSale; // 18 decimals
        string metadataURI;
        CurveType curveType;
        bool liquidityLocked;
        bool ownershipRenounced;
        /// @dev Seconds after launch when maxBuyBps applies (0 = off)
        uint32 antiSnipeSeconds;
        /// @dev Max tokens out per buy as bps of tokensForSale during anti-snipe window
        uint16 maxBuyBps;
        /// @dev Max cumulative tokens the creator may buy as bps of tokensForSale (0 = unlimited)
        uint16 creatorMaxBuyBps;
    }

    IERC20 public token;
    IERC20 public usdc;
    FeeRouter public feeRouter;
    address public graduationMigrator;
    address public creator;
    address public factory;

    bool public graduated;
    address public dexPair;

    uint16 public creatorFeeBps;
    uint256 public virtualUsdcReserve;
    uint256 public virtualTokenReserve;
    uint256 public tokensForSale;
    uint256 public tokensSold;
    uint256 public realUsdcReserve;
    string public metadataURI;
    CurveType public curveType;

    bool public liquidityLocked;
    bool public ownershipRenounced;
    address public teamVesting;
    bool public teamAllocated;

    bool public initialized;

    /// @notice Unix timestamp of initialize (launch)
    uint256 public launchedAt;
    uint32 public antiSnipeSeconds;
    uint16 public maxBuyBps;
    uint16 public creatorMaxBuyBps;
    /// @notice Tokens the creator has bought from the curve (not team vest)
    uint256 public creatorBought;
    /// @notice True if creator ever sold on the curve
    bool public creatorHasSold;

    event Buy(address indexed buyer, uint256 usdcIn, uint256 tokensOut, uint256 platformFee, uint256 creatorFee);
    event Sell(address indexed seller, uint256 tokensIn, uint256 usdcOut, uint256 platformFee, uint256 creatorFee);
    event TeamAllocated(address indexed vesting, uint256 amount);
    event Graduated(address indexed dexPair, uint256 usdcMigrated, uint256 tokensMigrated);
    event CreatorSold(address indexed creator, uint256 tokensIn, uint256 usdcOut);

    error AlreadyInitialized();
    error OnlyFactory();
    error OnlyMigrator();
    error ZeroAmount();
    error Slippage();
    error InsufficientTokens();
    error AlreadyAllocated();
    error AlreadyGraduated();
    error TradingClosed();
    error BuyLimitExceeded();
    error CreatorBuyLimit();

    function initialize(InitParams calldata params) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        factory = msg.sender;
        token = IERC20(params.token);
        usdc = IERC20(params.usdc);
        feeRouter = FeeRouter(params.feeRouter);
        graduationMigrator = params.graduationMigrator;
        creator = params.creator;
        creatorFeeBps = params.creatorFeeBps;
        virtualUsdcReserve = params.virtualUsdcReserve;
        virtualTokenReserve = params.virtualTokenReserve;
        tokensForSale = params.tokensForSale;
        metadataURI = params.metadataURI;
        curveType = params.curveType;
        liquidityLocked = params.liquidityLocked;
        ownershipRenounced = params.ownershipRenounced;
        launchedAt = block.timestamp;
        antiSnipeSeconds = params.antiSnipeSeconds;
        maxBuyBps = params.maxBuyBps;
        creatorMaxBuyBps = params.creatorMaxBuyBps;
    }

    function allocateTeamTokens(address vesting, uint256 amount) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (teamAllocated) revert AlreadyAllocated();
        teamAllocated = true;
        teamVesting = vesting;
        token.safeTransfer(vesting, amount);
        emit TeamAllocated(vesting, amount);
    }

    function buy(uint256 usdcIn, uint256 minTokensOut) external nonReentrant returns (uint256 tokensOut) {
        if (graduated) revert TradingClosed();
        if (usdcIn == 0) revert ZeroAmount();

        uint256 remaining = tokensForSale - tokensSold;
        if (remaining == 0) revert AlreadyGraduated();

        usdc.safeTransferFrom(msg.sender, address(this), usdcIn);

        // Gross quote after fees (platform + creator) so last-fill can refund excess.
        uint16 cBps = creatorFeeBps;
        uint16 maxC = feeRouter.maxCreatorFeeBps();
        if (cBps > maxC) cBps = maxC;
        uint256 totalFeeBps = uint256(feeRouter.platformTradeFeeBps()) + uint256(cBps);
        if (totalFeeBps >= 10_000) revert InsufficientTokens();

        uint256 netProbe = usdcIn - (usdcIn * totalFeeBps) / 10_000;
        tokensOut = _calculateBuy(netProbe);

        uint256 usdcUsed = usdcIn;
        if (tokensOut >= remaining) {
            tokensOut = remaining;
            uint256 netNeeded = _netUsdcForTokens(tokensOut);
            uint256 denom = 10_000 - totalFeeBps;
            usdcUsed = (netNeeded * 10_000 + denom - 1) / denom;
            if (usdcUsed > usdcIn) {
                usdcUsed = usdcIn;
            } else if (usdcUsed < usdcIn) {
                usdc.safeTransfer(msg.sender, usdcIn - usdcUsed);
            }
        }

        usdc.forceApprove(address(feeRouter), usdcUsed);
        uint256 netUsdc = feeRouter.takeTradeFees(address(this), creator, creatorFeeBps, usdcUsed);

        tokensOut = _calculateBuy(netUsdc);
        if (tokensOut > remaining) tokensOut = remaining;
        if (tokensOut < minTokensOut) revert Slippage();
        if (tokensOut == 0) revert ZeroAmount();

        _enforceBuyLimits(msg.sender, tokensOut);

        tokensSold += tokensOut;
        realUsdcReserve += netUsdc;
        virtualUsdcReserve += netUsdc;
        virtualTokenReserve -= tokensOut;

        if (msg.sender == creator) {
            creatorBought += tokensOut;
        }

        token.safeTransfer(msg.sender, tokensOut);

        emit Buy(msg.sender, usdcUsed, tokensOut, usdcUsed - netUsdc, 0);

        if (tokensSold >= tokensForSale && graduationMigrator != address(0)) {
            GraduationMigrator(graduationMigrator).graduate(address(this));
        }
    }

    function sell(uint256 tokensIn, uint256 minUsdcOut) external nonReentrant returns (uint256 usdcOut) {
        if (graduated) revert TradingClosed();
        if (tokensIn == 0) revert ZeroAmount();
        if (tokensIn > tokensSold) revert InsufficientTokens();

        token.safeTransferFrom(msg.sender, address(this), tokensIn);

        uint256 grossUsdc = _calculateSell(tokensIn);
        usdc.forceApprove(address(feeRouter), grossUsdc);
        usdcOut = feeRouter.takeTradeFees(address(this), creator, creatorFeeBps, grossUsdc);
        if (usdcOut < minUsdcOut) revert Slippage();

        tokensSold -= tokensIn;
        realUsdcReserve -= grossUsdc;
        virtualUsdcReserve -= grossUsdc;
        virtualTokenReserve += tokensIn;

        if (msg.sender == creator && !creatorHasSold) {
            creatorHasSold = true;
            emit CreatorSold(creator, tokensIn, usdcOut);
        }

        usdc.safeTransfer(msg.sender, usdcOut);

        emit Sell(msg.sender, tokensIn, usdcOut, grossUsdc - usdcOut, 0);
    }

    function _enforceBuyLimits(address buyer, uint256 tokensOut) internal view {
        // Anti-snipe: per-tx cap during early window
        if (antiSnipeSeconds > 0 && maxBuyBps > 0 && block.timestamp < launchedAt + antiSnipeSeconds) {
            uint256 maxOut = (tokensForSale * maxBuyBps) / 10_000;
            if (tokensOut > maxOut) revert BuyLimitExceeded();
        }
        // Creator cannot accumulate more than creatorMaxBuyBps of sale supply
        if (buyer == creator && creatorMaxBuyBps > 0) {
            uint256 maxCreator = (tokensForSale * creatorMaxBuyBps) / 10_000;
            if (creatorBought + tokensOut > maxCreator) revert CreatorBuyLimit();
        }
    }

    function _calculateBuy(uint256 usdcIn) internal view returns (uint256 tokensOut) {
        if (usdcIn == 0 || virtualTokenReserve == 0) return 0;
        uint256 k = virtualUsdcReserve * virtualTokenReserve;
        uint256 newVirtualUsdc = virtualUsdcReserve + usdcIn;
        uint256 newVirtualTokens = k / newVirtualUsdc;
        tokensOut = virtualTokenReserve - newVirtualTokens;
    }

    /// @dev Minimum net USDC (after fees) required to buy exactly `tokensOut` from the curve.
    function _netUsdcForTokens(uint256 tokensOut) internal view returns (uint256 netUsdc) {
        if (tokensOut == 0) return 0;
        if (tokensOut >= virtualTokenReserve) revert InsufficientTokens();
        uint256 newVirtualTokens = virtualTokenReserve - tokensOut;
        uint256 k = virtualUsdcReserve * virtualTokenReserve;
        uint256 targetUsdc = (k + newVirtualTokens - 1) / newVirtualTokens;
        netUsdc = targetUsdc - virtualUsdcReserve;
        if (netUsdc == 0) netUsdc = 1;
    }

    function _calculateSell(uint256 tokensIn) internal view returns (uint256 usdcOut) {
        uint256 k = virtualUsdcReserve * virtualTokenReserve;
        uint256 newVirtualTokens = virtualTokenReserve + tokensIn;
        uint256 newVirtualUsdc = k / newVirtualTokens;
        usdcOut = virtualUsdcReserve - newVirtualUsdc;
    }

    /// @notice Spot price in USDC (6 decimals) per 1 whole token (1e18 wei).
    function getPrice() external view returns (uint256 usdcPerToken) {
        if (virtualTokenReserve == 0) return 0;
        usdcPerToken = (virtualUsdcReserve * 1e18) / virtualTokenReserve;
    }

    /// @notice Fully-diluted mcap in USDC (6 decimals).
    function marketCapUsdc() external view returns (uint256) {
        if (virtualTokenReserve == 0) return 0;
        uint256 supply = ArcToken(address(token)).totalSupply();
        return (supply * virtualUsdcReserve) / virtualTokenReserve;
    }

    function pullAssetsForGraduation() external {
        if (msg.sender != graduationMigrator) revert OnlyMigrator();
        if (graduated) revert AlreadyGraduated();
        if (tokensSold < tokensForSale) revert InsufficientTokens();
        graduated = true;

        uint256 usdcBal = usdc.balanceOf(address(this));
        uint256 tokenBal = token.balanceOf(address(this));
        if (usdcBal > 0) usdc.safeTransfer(graduationMigrator, usdcBal);
        if (tokenBal > 0) token.safeTransfer(graduationMigrator, tokenBal);
    }

    function markGraduated(address pair_) external {
        if (msg.sender != graduationMigrator) revert OnlyMigrator();
        dexPair = pair_;
        emit Graduated(pair_, usdc.balanceOf(address(this)), token.balanceOf(address(this)));
    }
}
