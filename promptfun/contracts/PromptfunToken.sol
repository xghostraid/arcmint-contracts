// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply ERC-20. The whole supply is minted once, to the deployer, in the constructor.
/// There is no owner, no mint, no burn, no pause and no upgrade path, so the supply can never change.
contract PromptfunToken is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 supply_) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
        _mint(msg.sender, supply_);
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }
}
