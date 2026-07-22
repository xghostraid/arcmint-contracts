// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// @dev Superseded by DeployV3.s.sol (graduation + ArcSwap DEX stack)
contract Deploy is Script {
    function run() external {
        revert("Use DeployV3.s.sol");
    }
}