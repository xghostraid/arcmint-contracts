// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TokenVesting — linear team allocation with optional cliff
contract TokenVesting {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable start;
    uint256 public immutable cliff;
    uint256 public immutable duration;
    uint256 public immutable totalAmount;
    uint256 public released;

    event Released(address indexed beneficiary, uint256 amount);

    error NothingToRelease();
    error InvalidSchedule();

    constructor(
        address token_,
        address beneficiary_,
        uint256 start_,
        uint256 cliffDuration_,
        uint256 vestingDuration_,
        uint256 totalAmount_
    ) {
        if (beneficiary_ == address(0) || totalAmount_ == 0) revert InvalidSchedule();
        if (vestingDuration_ == 0 && cliffDuration_ > 0) revert InvalidSchedule();

        token = IERC20(token_);
        beneficiary = beneficiary_;
        start = start_;
        cliff = start_ + cliffDuration_;
        duration = vestingDuration_ == 0 ? 1 : vestingDuration_;
        totalAmount = totalAmount_;
    }

    function vestedAmount(uint256 timestamp) public view returns (uint256) {
        if (timestamp < cliff) return 0;
        if (timestamp >= start + duration) return totalAmount;

        uint256 elapsed = timestamp - start;
        return (totalAmount * elapsed) / duration;
    }

    function releasable() public view returns (uint256) {
        return vestedAmount(block.timestamp) - released;
    }

    function release() external returns (uint256 amount) {
        amount = releasable();
        if (amount == 0) revert NothingToRelease();
        released += amount;
        token.safeTransfer(beneficiary, amount);
        emit Released(beneficiary, amount);
    }
}