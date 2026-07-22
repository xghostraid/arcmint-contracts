// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArcMintFactory} from "../src/ArcMintFactory.sol";
import {BondingCurvePool} from "../src/BondingCurvePool.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {ArcToken} from "../src/ArcToken.sol";
import {TokenVesting} from "../src/TokenVesting.sol";
import {GraduationMigrator} from "../src/GraduationMigrator.sol";
import {LiquidityLocker} from "../src/LiquidityLocker.sol";
import {ArcSwapFactory} from "../src/dex/ArcSwapFactory.sol";
import {ArcSwapRouter} from "../src/dex/ArcSwapRouter.sol";
import {ArcSwapPair} from "../src/dex/ArcSwapPair.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ArcMintTest is Test {
    using stdStorage for StdStorage;

    MockUSDC usdc;
    FeeRouter feeRouter;
    BondingCurvePool curveImpl;
    GraduationMigrator migrator;
    ArcMintFactory factory;

    address creator = address(0xC0FFEE);
    address buyer = address(0xBEEF);
    address teamWallet = address(0x7EAA);

    function setUp() public {
        usdc = new MockUSDC();
        feeRouter = new FeeRouter(address(usdc), address(this), address(this));
        curveImpl = new BondingCurvePool();
        ArcSwapFactory swapFactory = new ArcSwapFactory(address(this));
        ArcSwapRouter swapRouter = new ArcSwapRouter(address(swapFactory));
        LiquidityLocker locker = new LiquidityLocker();
        migrator = new GraduationMigrator(address(usdc), address(feeRouter), address(swapRouter), address(locker));
        factory = new ArcMintFactory(address(usdc), address(feeRouter), address(curveImpl), address(migrator));
        feeRouter.setFactory(address(factory));
        feeRouter.setGraduationMigrator(address(migrator));
        migrator.setFactory(address(factory));

        usdc.mint(buyer, 100_000e6);
        usdc.mint(creator, 100_000e6);
        vm.prank(buyer);
        usdc.approve(address(factory), type(uint256).max);
        vm.prank(creator);
        usdc.approve(address(factory), type(uint256).max);
    }

    function _baseParams() internal pure returns (ArcMintFactory.LaunchParams memory) {
        return ArcMintFactory.LaunchParams({
            name: "Test Token",
            symbol: "TEST",
            metadataURI: "ipfs://test",
            creatorFeeBps: 200,
            curveType: BondingCurvePool.CurveType.LINEAR_VIRTUAL,
            teamAllocationBps: 0,
            teamWallet: address(0),
            vestingCliff: 0,
            vestingDuration: 0,
            liquidityLocked: false,
            ownershipRenounced: false
        });
    }

    function _skipAntiSnipe(address pool) internal {
        uint256 t = BondingCurvePool(pool).launchedAt() + BondingCurvePool(pool).antiSnipeSeconds() + 1;
        vm.warp(t);
    }

    function test_createLaunch_and_buy() public {
        vm.prank(creator);
        (address token, address pool) = factory.createLaunch(_baseParams());

        assertTrue(token != address(0));
        assertTrue(pool != address(0));
        assertEq(ArcToken(token).balanceOf(pool), ArcToken(token).TOTAL_SUPPLY());

        _skipAntiSnipe(pool);
        vm.startPrank(buyer);
        usdc.approve(pool, 100e6);
        uint256 tokensOut = BondingCurvePool(pool).buy(100e6, 0);
        vm.stopPrank();

        assertGt(tokensOut, 0);
        assertGt(ArcToken(token).balanceOf(buyer), 0);
        assertGt(BondingCurvePool(pool).realUsdcReserve(), 0);
    }

    function test_team_vesting_and_transparency_flags() public {
        ArcMintFactory.LaunchParams memory params = _baseParams();
        params.teamAllocationBps = 500;
        params.teamWallet = teamWallet;
        params.vestingCliff = 7 days;
        params.vestingDuration = 30 days;
        params.liquidityLocked = true;
        params.ownershipRenounced = true;

        vm.prank(creator);
        (address token, address pool) = factory.createLaunch(params);

        address vesting = BondingCurvePool(pool).teamVesting();
        assertTrue(vesting != address(0));

        uint256 teamAmount = (ArcToken(token).TOTAL_SUPPLY() * 500) / 10_000;
        assertEq(ArcToken(token).balanceOf(vesting), teamAmount);
        assertEq(BondingCurvePool(pool).teamVesting(), vesting);
        assertTrue(BondingCurvePool(pool).liquidityLocked());
        assertTrue(BondingCurvePool(pool).ownershipRenounced());

        vm.warp(block.timestamp + 7 days + 15 days);
        TokenVesting(vesting).release();
        assertGt(ArcToken(token).balanceOf(teamWallet), 0);
    }

    function test_graduation_migrates_to_dex() public {
        vm.prank(creator);
        (address token, address pool) = factory.createLaunch(_baseParams());

        usdc.mint(pool, 10_000e6);
        deal(token, pool, 1_000_000e18);

        uint256 tokensForSale = BondingCurvePool(pool).tokensForSale();
        stdstore.target(pool).sig("tokensSold()").checked_write(tokensForSale);

        migrator.graduate(pool);

        assertTrue(BondingCurvePool(pool).graduated());
        address dexPair = BondingCurvePool(pool).dexPair();
        assertTrue(dexPair != address(0));
        assertGt(ArcSwapPair(dexPair).totalSupply(), 0);
    }

    function test_buy_path_graduates_curve() public {
        vm.prank(creator);
        (address token, address pool) = factory.createLaunch(_baseParams());
        _skipAntiSnipe(pool);

        vm.startPrank(buyer);
        usdc.approve(pool, type(uint256).max);
        BondingCurvePool(pool).buy(50e6, 0);
        vm.stopPrank();

        assertTrue(BondingCurvePool(pool).graduated());
        assertEq(BondingCurvePool(pool).tokensSold(), BondingCurvePool(pool).tokensForSale());
        assertTrue(BondingCurvePool(pool).dexPair() != address(0));
        assertGt(ArcToken(token).balanceOf(buyer), 0);
    }

    function test_market_cap_nonzero_on_empty_curve() public {
        vm.prank(creator);
        (, address pool) = factory.createLaunch(_baseParams());

        uint256 mcap = BondingCurvePool(pool).marketCapUsdc();
        assertEq(mcap, 750_000);
    }

    function test_buy_then_sell_partial() public {
        vm.prank(creator);
        (address token, address pool) = factory.createLaunch(_baseParams());
        _skipAntiSnipe(pool);

        vm.startPrank(buyer);
        usdc.approve(pool, type(uint256).max);
        ArcToken(token).approve(pool, type(uint256).max);
        uint256 out = BondingCurvePool(pool).buy(0.05e6, 0);
        assertGt(out, 0);
        assertFalse(BondingCurvePool(pool).graduated());
        uint256 bal = ArcToken(token).balanceOf(buyer);
        uint256 sellAmt = (bal * 9_000) / 10_000;
        uint256 usdcOut = BondingCurvePool(pool).sell(sellAmt, 0);
        assertGt(usdcOut, 0);
        vm.stopPrank();
    }

    function test_last_buy_caps_and_graduates() public {
        vm.prank(creator);
        (, address pool) = factory.createLaunch(_baseParams());
        _skipAntiSnipe(pool);

        vm.startPrank(buyer);
        usdc.approve(pool, type(uint256).max);
        BondingCurvePool(pool).buy(100e6, 0);
        vm.stopPrank();

        assertTrue(BondingCurvePool(pool).graduated());
        assertEq(BondingCurvePool(pool).tokensSold(), BondingCurvePool(pool).tokensForSale());
    }

    function test_revert_team_without_wallet() public {
        ArcMintFactory.LaunchParams memory params = _baseParams();
        params.teamAllocationBps = 100;

        vm.prank(creator);
        vm.expectRevert(ArcMintFactory.InvalidTeamWallet.selector);
        factory.createLaunch(params);
    }

    function test_trading_closed_after_graduate() public {
        vm.prank(creator);
        (address token, address pool) = factory.createLaunch(_baseParams());
        _skipAntiSnipe(pool);

        vm.startPrank(buyer);
        usdc.approve(pool, type(uint256).max);
        BondingCurvePool(pool).buy(50e6, 0);
        vm.stopPrank();

        assertTrue(BondingCurvePool(pool).graduated());

        vm.startPrank(buyer);
        vm.expectRevert(BondingCurvePool.TradingClosed.selector);
        BondingCurvePool(pool).buy(1e6, 0);

        ArcToken(token).approve(pool, type(uint256).max);
        uint256 bal = ArcToken(token).balanceOf(buyer);
        if (bal > 0) {
            vm.expectRevert(BondingCurvePool.TradingClosed.selector);
            BondingCurvePool(pool).sell(bal / 100, 0);
        }
        vm.stopPrank();
    }

    function test_buy_slippage_reverts() public {
        vm.prank(creator);
        (, address pool) = factory.createLaunch(_baseParams());
        _skipAntiSnipe(pool);

        vm.startPrank(buyer);
        usdc.approve(pool, type(uint256).max);
        vm.expectRevert(BondingCurvePool.Slippage.selector);
        BondingCurvePool(pool).buy(1e6, type(uint256).max);
        vm.stopPrank();
    }

    function test_only_migrator_pulls_assets() public {
        vm.prank(creator);
        (, address pool) = factory.createLaunch(_baseParams());

        vm.expectRevert(BondingCurvePool.OnlyMigrator.selector);
        BondingCurvePool(pool).pullAssetsForGraduation();
    }

    function test_last_buy_refunds_excess_usdc() public {
        vm.prank(creator);
        (, address pool) = factory.createLaunch(_baseParams());
        _skipAntiSnipe(pool);

        vm.startPrank(buyer);
        usdc.approve(pool, type(uint256).max);
        BondingCurvePool(pool).buy(0.5e6, 0);
        assertFalse(BondingCurvePool(pool).graduated());

        uint256 balBefore = usdc.balanceOf(buyer);
        BondingCurvePool(pool).buy(100e6, 0);
        uint256 balAfter = usdc.balanceOf(buyer);
        vm.stopPrank();

        assertTrue(BondingCurvePool(pool).graduated());
        assertLt(balBefore - balAfter, 100e6);
        assertGt(balBefore - balAfter, 0);
    }

    function test_anti_snipe_limits_large_buy() public {
        vm.prank(creator);
        (, address pool) = factory.createLaunch(_baseParams());

        // Still inside 60s window — large buy should revert
        vm.startPrank(buyer);
        usdc.approve(pool, type(uint256).max);
        vm.expectRevert(BondingCurvePool.BuyLimitExceeded.selector);
        BondingCurvePool(pool).buy(50e6, 0);
        vm.stopPrank();
    }

    function test_creator_sold_flag() public {
        vm.prank(creator);
        (address token, address pool) = factory.createLaunch(_baseParams());
        _skipAntiSnipe(pool);

        // Buyer trades, then we transfer tokens to creator and creator sells
        vm.startPrank(buyer);
        usdc.approve(pool, type(uint256).max);
        BondingCurvePool(pool).buy(0.1e6, 0);
        uint256 bal = ArcToken(token).balanceOf(buyer);
        ArcToken(token).transfer(creator, bal / 2);
        vm.stopPrank();

        assertFalse(BondingCurvePool(pool).creatorHasSold());

        vm.startPrank(creator);
        ArcToken(token).approve(pool, type(uint256).max);
        BondingCurvePool(pool).sell(bal / 4, 0);
        vm.stopPrank();

        assertTrue(BondingCurvePool(pool).creatorHasSold());
    }

    function test_creator_fee_locked_until_graduate() public {
        ArcMintFactory.LaunchParams memory params = _baseParams();
        params.creatorFeeBps = 200;
        vm.prank(creator);
        (, address pool) = factory.createLaunch(params);
        _skipAntiSnipe(pool);

        vm.startPrank(buyer);
        usdc.approve(pool, type(uint256).max);
        BondingCurvePool(pool).buy(0.2e6, 0);
        vm.stopPrank();

        assertGt(feeRouter.creatorFeesByPool(creator, pool), 0);
        assertFalse(feeRouter.creatorFeesUnlocked(pool));

        vm.prank(creator);
        vm.expectRevert(FeeRouter.FeesLocked.selector);
        feeRouter.claimCreatorFeesForPool(pool);

        // Graduate via large buy
        vm.startPrank(buyer);
        BondingCurvePool(pool).buy(50e6, 0);
        vm.stopPrank();
        assertTrue(BondingCurvePool(pool).graduated());
        assertTrue(feeRouter.creatorFeesUnlocked(pool));

        uint256 before = usdc.balanceOf(creator);
        vm.prank(creator);
        feeRouter.claimCreatorFeesForPool(pool);
        assertGt(usdc.balanceOf(creator), before);
    }
}
