// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ArcToken} from "./ArcToken.sol";
import {BondingCurvePool} from "./BondingCurvePool.sol";
import {FeeRouter} from "./FeeRouter.sol";
import {TokenVesting} from "./TokenVesting.sol";
import {GraduationMigrator} from "./GraduationMigrator.sol";

/// @title ArcMintFactory — deploy tokens + bonding curve pools on Arc
contract ArcMintFactory is Ownable {
    using SafeERC20 for IERC20;

    struct LaunchParams {
        string name;
        string symbol;
        string metadataURI;
        uint16 creatorFeeBps;
        BondingCurvePool.CurveType curveType;
        uint16 teamAllocationBps;
        address teamWallet;
        uint32 vestingCliff;
        uint32 vestingDuration;
        bool liquidityLocked;
        bool ownershipRenounced;
    }

    IERC20 public immutable usdc;
    FeeRouter public immutable feeRouter;
    address public immutable curveImplementation;
    GraduationMigrator public immutable graduationMigrator;

    uint256 public constant TOKENS_FOR_SALE_BPS = 8000; // 80% on curve
    uint256 public constant MAX_TEAM_BPS = 1500; // 15% max team allocation
    uint256 public constant DEFAULT_VIRTUAL_USDC = 30e6; // $30 virtual USDC
    /// @dev Virtual token reserve multiplier vs tokensForSale. Must be > 1 so the
    /// curve can be fully sold with finite USDC (constant-product never empties reserve).
    /// Cost to fill ≈ virtualUsdc / (multiplier - 1). With 50× and $30 → ~$0.61 net.
    uint256 public constant VIRTUAL_TOKEN_MULTIPLIER = 50;

    /// @dev Anti-snipe window: max buy size applies for this many seconds after launch
    uint32 public constant ANTI_SNIPE_SECONDS = 60;
    /// @dev Max tokens per buy as bps of tokensForSale during anti-snipe (200 = 2%)
    uint16 public constant MAX_BUY_BPS_SNIPE = 200;
    /// @dev Creator max cumulative curve buys as bps of tokensForSale (500 = 5%)
    uint16 public constant CREATOR_MAX_BUY_BPS = 500;

    uint256 public launchCount;

    mapping(address => address) public tokenToPool;
    mapping(address => address) public poolToToken;
    mapping(uint256 => address) public launchByIndex;
    mapping(address => LaunchInfo) public launches;

    struct LaunchInfo {
        address token;
        address pool;
        address creator;
        uint256 createdAt;
        string name;
        string symbol;
        string metadataURI;
        address teamVesting;
    }

    event Launched(
        address indexed token,
        address indexed pool,
        address indexed creator,
        string name,
        string symbol
    );

    error InvalidFee();
    error InvalidTeamAllocation();
    error InvalidTeamWallet();

    constructor(
        address usdc_,
        address feeRouter_,
        address curveImplementation_,
        address graduationMigrator_
    ) Ownable(msg.sender) {
        usdc = IERC20(usdc_);
        feeRouter = FeeRouter(feeRouter_);
        curveImplementation = curveImplementation_;
        graduationMigrator = GraduationMigrator(graduationMigrator_);
    }

    function createLaunch(LaunchParams calldata params) external returns (address token, address pool) {
        if (params.creatorFeeBps > feeRouter.maxCreatorFeeBps()) revert InvalidFee();
        if (params.teamAllocationBps > MAX_TEAM_BPS) revert InvalidTeamAllocation();
        if (params.teamAllocationBps > 0 && params.teamWallet == address(0)) revert InvalidTeamWallet();

        ArcToken newToken = new ArcToken(params.name, params.symbol, address(this));
        token = address(newToken);

        pool = Clones.clone(curveImplementation);
        feeRouter.authorizePoolFromFactory(pool);

        uint256 tokensForSale = (ArcToken(token).TOTAL_SUPPLY() * TOKENS_FOR_SALE_BPS) / 10_000;
        uint256 virtualTokenReserve = tokensForSale * VIRTUAL_TOKEN_MULTIPLIER;

        BondingCurvePool(pool).initialize(
            BondingCurvePool.InitParams({
                token: token,
                usdc: address(usdc),
                feeRouter: address(feeRouter),
                graduationMigrator: address(graduationMigrator),
                creator: msg.sender,
                creatorFeeBps: params.creatorFeeBps,
                virtualUsdcReserve: DEFAULT_VIRTUAL_USDC,
                virtualTokenReserve: virtualTokenReserve,
                tokensForSale: tokensForSale,
                metadataURI: params.metadataURI,
                curveType: params.curveType,
                liquidityLocked: params.liquidityLocked,
                ownershipRenounced: params.ownershipRenounced,
                antiSnipeSeconds: ANTI_SNIPE_SECONDS,
                maxBuyBps: MAX_BUY_BPS_SNIPE,
                creatorMaxBuyBps: CREATOR_MAX_BUY_BPS
            })
        );

        newToken.mintTo(pool);
        graduationMigrator.authorizePool(pool, true);

        address vesting = address(0);
        if (params.teamAllocationBps > 0) {
            uint256 teamAmount = (ArcToken(token).TOTAL_SUPPLY() * params.teamAllocationBps) / 10_000;
            vesting = address(
                new TokenVesting(
                    token,
                    params.teamWallet,
                    block.timestamp,
                    params.vestingCliff,
                    params.vestingDuration,
                    teamAmount
                )
            );
            BondingCurvePool(pool).allocateTeamTokens(vesting, teamAmount);
        }

        tokenToPool[token] = pool;
        poolToToken[pool] = token;
        launchByIndex[launchCount] = token;
        launches[token] = LaunchInfo({
            token: token,
            pool: pool,
            creator: msg.sender,
            createdAt: block.timestamp,
            name: params.name,
            symbol: params.symbol,
            metadataURI: params.metadataURI,
            teamVesting: vesting
        });
        launchCount++;

        emit Launched(token, pool, msg.sender, params.name, params.symbol);
    }

    function getLaunchCount() external view returns (uint256) {
        return launchCount;
    }
}