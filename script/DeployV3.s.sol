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

/// @notice Deploys full v3 stack. Optional env:
///   PLATFORM_OWNER — admin + SwapFactory feeToSetter (defaults to msg.sender)
///   TREASURY — fee recipient (defaults to PLATFORM_OWNER)
contract DeployV3 is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        // Canonical platform wallet (owner, feeToSetter, default treasury)
        address platformOwner = vm.envOr("PLATFORM_OWNER", deployer);
        address treasury = vm.envOr("TREASURY", platformOwner);

        vm.startBroadcast(deployerKey);

        BondingCurvePool curveImpl = new BondingCurvePool();
        // 100% platform fees → treasury (treasury + staking slots)
        FeeRouter feeRouter = new FeeRouter(USDC, treasury, treasury);
        ArcSwapFactory swapFactory = new ArcSwapFactory(platformOwner);
        ArcSwapRouter swapRouter = new ArcSwapRouter(address(swapFactory));
        LiquidityLocker locker = new LiquidityLocker();
        GraduationMigrator migrator =
            new GraduationMigrator(USDC, address(feeRouter), address(swapRouter), address(locker));
        ArcMintFactory factory =
            new ArcMintFactory(USDC, address(feeRouter), address(curveImpl), address(migrator));

        feeRouter.setFactory(address(factory));
        feeRouter.setGraduationMigrator(address(migrator));
        migrator.setFactory(address(factory));

        // Hand full admin to platform owner when a bootstrap key is used to pay gas
        if (platformOwner != deployer) {
            feeRouter.transferOwnership(platformOwner);
            factory.transferOwnership(platformOwner);
        }

        vm.stopBroadcast();

        console2.log("PlatformOwner:", platformOwner);
        console2.log("Treasury:", treasury);
        console2.log("BroadcastFrom:", deployer);
        console2.log("FeeRouter:", address(feeRouter));
        console2.log("CurveImpl:", address(curveImpl));
        console2.log("SwapFactory:", address(swapFactory));
        console2.log("SwapRouter:", address(swapRouter));
        console2.log("LiquidityLocker:", address(locker));
        console2.log("GraduationMigrator:", address(migrator));
        console2.log("Factory v3:", address(factory));
    }
}
