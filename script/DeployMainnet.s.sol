// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ArcMintFactory} from "../src/ArcMintFactory.sol";
import {BondingCurvePool} from "../src/BondingCurvePool.sol";
import {FeeRouter} from "../src/FeeRouter.sol";
import {GraduationMigrator} from "../src/GraduationMigrator.sol";
import {LiquidityLocker} from "../src/LiquidityLocker.sol";
import {ArcSwapFactory} from "../src/dex/ArcSwapFactory.sol";
import {ArcSwapRouter} from "../src/dex/ArcSwapRouter.sol";

/// @notice Mainnet deploy scaffold — only run when Arc Mainnet RPC + USDC are published.
/// Env:
///   PRIVATE_KEY
///   ARC_MAINNET_USDC — ERC-20 USDC (required; do not use testnet address blindly)
///   PLATFORM_OWNER (optional)
///   TREASURY (optional)
///
/// forge script script/DeployMainnet.s.sol:DeployMainnet \
///   --rpc-url $ARC_MAINNET_RPC --broadcast --legacy
contract DeployMainnet is Script {
    function run() external {
        address usdc = vm.envAddress("ARC_MAINNET_USDC");
        require(usdc != address(0), "Set ARC_MAINNET_USDC from official Arc mainnet docs");

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address platformOwner = vm.envOr("PLATFORM_OWNER", deployer);
        address treasury = vm.envOr("TREASURY", platformOwner);

        vm.startBroadcast(deployerKey);

        BondingCurvePool curveImpl = new BondingCurvePool();
        FeeRouter feeRouter = new FeeRouter(usdc, treasury, treasury);
        ArcSwapFactory swapFactory = new ArcSwapFactory(platformOwner);
        ArcSwapRouter swapRouter = new ArcSwapRouter(address(swapFactory));
        LiquidityLocker locker = new LiquidityLocker();
        GraduationMigrator migrator =
            new GraduationMigrator(usdc, address(feeRouter), address(swapRouter), address(locker));
        ArcMintFactory factory =
            new ArcMintFactory(usdc, address(feeRouter), address(curveImpl), address(migrator));

        feeRouter.setFactory(address(factory));
        feeRouter.setGraduationMigrator(address(migrator));
        migrator.setFactory(address(factory));

        if (platformOwner != deployer) {
            feeRouter.transferOwnership(platformOwner);
            factory.transferOwnership(platformOwner);
        }

        vm.stopBroadcast();

        console2.log("=== MAINNET DEPLOY ===");
        console2.log("USDC:", usdc);
        console2.log("PlatformOwner:", platformOwner);
        console2.log("Treasury:", treasury);
        console2.log("FeeRouter:", address(feeRouter));
        console2.log("CurveImpl:", address(curveImpl));
        console2.log("SwapFactory:", address(swapFactory));
        console2.log("SwapRouter:", address(swapRouter));
        console2.log("LiquidityLocker:", address(locker));
        console2.log("GraduationMigrator:", address(migrator));
        console2.log("Factory:", address(factory));
    }
}
