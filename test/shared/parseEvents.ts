import '@nomiclabs/hardhat-ethers'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import hre from 'hardhat'
const { ethers } = hre

export const V2_EVENTS = new ethers.utils.Interface([
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
])

export const UNISWAP_V3_EVENTS = new ethers.utils.Interface([
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
])

export const ALGEBRA_INTEGRAL_EVENTS = new ethers.utils.Interface([
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 price, uint128 liquidity, int24 tick)',
])

export const ALGEBRA_INTEGRAL_POSITION_EVENTS = new ethers.utils.Interface([
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidityDesired, uint128 actualLiquidity, uint256 amount0, uint256 amount1, address pool)',
  'event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
])

export function parseEvents(iface: ethers.utils.Interface, receipt: TransactionReceipt) {
  return receipt.logs
    .map((log) => {
      try {
        return iface.parseLog(log)
      } catch {
        return undefined
      }
    })
    .filter((log) => log !== undefined)
}
