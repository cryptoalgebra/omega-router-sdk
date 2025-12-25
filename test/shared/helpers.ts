import { ADDRESS_ZERO, AnyToken, encodeSqrtRatioX96, Pool } from '@cryptoalgebra/integral-sdk'

// Helper to create an Integral pool
export function createMockIntegralPool(token0: AnyToken, token1: AnyToken): Pool {
  const fee = 500 // 0.05% fee
  const sqrtPriceX96 = encodeSqrtRatioX96(1, 1)
  const deployer = ADDRESS_ZERO
  const liquidity = '1000000000000000000000'
  const tick = 0
  const tickSpacing = 60

  return new Pool(token0, token1, fee, sqrtPriceX96, deployer, liquidity, tick, tickSpacing)
}
