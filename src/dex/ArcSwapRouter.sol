// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ArcSwapFactory} from "./ArcSwapFactory.sol";
import {ArcSwapPair} from "./ArcSwapPair.sol";

/// @title ArcSwapRouter — add liquidity + swaps for graduated tokens
contract ArcSwapRouter {
    using SafeERC20 for IERC20;

    ArcSwapFactory public immutable factory;

    constructor(address factory_) {
        factory = ArcSwapFactory(factory_);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        (amountADesired, amountBDesired) = tokenA == token0 ? (amountADesired, amountBDesired) : (amountBDesired, amountADesired);
        (amountAMin, amountBMin) = tokenA == token0 ? (amountAMin, amountBMin) : (amountBMin, amountAMin);

        address pair = factory.getPair(token0, token1);
        if (pair == address(0)) {
            pair = factory.createPair(token0, token1);
        }

        (amountA, amountB) = _quoteLiquidity(pair, token0, token1, amountADesired, amountBDesired, amountAMin, amountBMin);

        IERC20(token0).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(token1).safeTransferFrom(msg.sender, pair, amountB);
        liquidity = ArcSwapPair(pair).mint(to);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to
    ) external returns (uint256 amountOut) {
        require(path.length == 2, "INVALID_PATH");
        address pair = factory.getPair(path[0], path[1]);
        require(pair != address(0), "NO_PAIR");

        (address token0,) = path[0] < path[1] ? (path[0], path[1]) : (path[1], path[0]);
        (uint256 amount0Out, uint256 amount1Out) =
            path[0] == token0 ? (uint256(0), amountOutMin) : (amountOutMin, uint256(0));

        IERC20(path[0]).safeTransferFrom(msg.sender, pair, amountIn);
        (amount0Out, amount1Out) = _getAmountsOut(pair, path[0], amountIn);
        ArcSwapPair(pair).swap(amount0Out, amount1Out, to);
        amountOut = path[0] == token0 ? amount1Out : amount0Out;
        require(amountOut >= amountOutMin, "SLIPPAGE");
    }

    function _quoteLiquidity(
        address pair,
        address token0,
        address token1,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) private view returns (uint256 amountA, uint256 amountB) {
        if (ArcSwapPair(pair).totalSupply() == 0) {
            amountA = amountADesired;
            amountB = amountBDesired;
        } else {
            (uint112 r0, uint112 r1,) = ArcSwapPair(pair).getReserves();
            uint256 amountBOptimal = (amountADesired * r1) / r0;
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "INSUFFICIENT_B");
                amountA = amountADesired;
                amountB = amountBOptimal;
            } else {
                uint256 amountAOptimal = (amountBDesired * r0) / r1;
                require(amountAOptimal <= amountADesired && amountAOptimal >= amountAMin, "INSUFFICIENT_A");
                amountA = amountAOptimal;
                amountB = amountBDesired;
            }
        }
    }

    function _getAmountsOut(address pair, address tokenIn, uint256 amountIn)
        private
        view
        returns (uint256 amount0Out, uint256 amount1Out)
    {
        ArcSwapPair p = ArcSwapPair(pair);
        (uint112 r0, uint112 r1,) = p.getReserves();
        address token0 = p.token0();
        bool zeroForOne = tokenIn == token0;
        uint256 reserveIn = zeroForOne ? r0 : r1;
        uint256 reserveOut = zeroForOne ? r1 : r0;
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        uint256 out = numerator / denominator;
        if (zeroForOne) amount1Out = out;
        else amount0Out = out;
    }
}