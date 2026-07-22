// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title ArcToken — fixed-supply ERC-20 minted once to bonding curve
contract ArcToken is ERC20 {
    address public immutable factory;
    bool public minted;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether; // 1B tokens, 18 decimals

    error OnlyFactory();
    error AlreadyMinted();

    constructor(string memory name_, string memory symbol_, address factory_) ERC20(name_, symbol_) {
        factory = factory_;
    }

    function mintTo(address to) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (minted) revert AlreadyMinted();
        minted = true;
        _mint(to, TOTAL_SUPPLY);
    }
}