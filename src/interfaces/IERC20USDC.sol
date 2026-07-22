// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Arc USDC ERC-20 interface uses 6 decimals (0x3600...0000 on testnet)
interface IERC20USDC is IERC20 {}