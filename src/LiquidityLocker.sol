// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title LiquidityLocker — timelocks LP tokens after graduation
contract LiquidityLocker {
    using SafeERC20 for IERC20;

    struct Lock {
        address lpToken;
        address beneficiary;
        uint256 amount;
        uint256 unlockTime;
        bool released;
    }

    uint256 public lockCount;
    mapping(uint256 => Lock) public locks;

    event Locked(uint256 indexed lockId, address indexed lpToken, address beneficiary, uint256 amount, uint256 unlockTime);
    event Released(uint256 indexed lockId, address indexed beneficiary, uint256 amount);

    error NotBeneficiary();
    error StillLocked();
    error AlreadyReleased();

    function lock(address lpToken, uint256 amount, address beneficiary, uint256 unlockTime)
        external
        returns (uint256 lockId)
    {
        IERC20(lpToken).safeTransferFrom(msg.sender, address(this), amount);
        lockId = lockCount++;
        locks[lockId] = Lock({
            lpToken: lpToken,
            beneficiary: beneficiary,
            amount: amount,
            unlockTime: unlockTime,
            released: false
        });
        emit Locked(lockId, lpToken, beneficiary, amount, unlockTime);
    }

    function release(uint256 lockId) external {
        Lock storage l = locks[lockId];
        if (l.released) revert AlreadyReleased();
        if (msg.sender != l.beneficiary) revert NotBeneficiary();
        if (block.timestamp < l.unlockTime) revert StillLocked();
        l.released = true;
        IERC20(l.lpToken).safeTransfer(l.beneficiary, l.amount);
        emit Released(lockId, l.beneficiary, l.amount);
    }
}