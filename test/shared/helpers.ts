import {
  ADDRESS_ZERO,
  AnyToken,
  CurrencyAmount,
  encodeSqrtRatioX96,
  Pool as IntegralPool,
  Route as IntegralRoute,
  TradeType,
  Token,
  BoostedRoute as IntegralBoostedRoute,
} from '@cryptoalgebra/integral-sdk'
import { OmegaTrade } from '../../src/index'
import { Pool as V3Pool } from '@uniswap/v3-sdk'
import { BigNumber, BigNumberish } from 'ethers'
import { RouteV2, RouteV3 } from '@uniswap/router-sdk'

export enum Protocol {
  V2 = 'V2',
  V3 = 'V3',
  INTEGRAL = 'INTEGRAL',
  INTEGRAL_BOOSTED = 'INTEGRAL_BOOSTED',
  MIXED = 'MIXED',
}

// Helper to create an Integral pool
export function createMockIntegralPool(token0: AnyToken, token1: AnyToken): IntegralPool {
  const fee = 500 // 0.05% fee
  const sqrtPriceX96 = encodeSqrtRatioX96(1, 1)
  const deployer = ADDRESS_ZERO
  const liquidity = '1000000000000000000000'
  const tick = 0
  const tickSpacing = 60

  const sorted0 = token0.sortsBefore(token1) ? token0 : token1
  const sorted1 = token0.sortsBefore(token1) ? token1 : token0

  return new IntegralPool(sorted0, sorted1, fee, sqrtPriceX96, deployer, liquidity, tick, tickSpacing)
}

export function createMockUniswapV3Pool(token0: Token, token1: Token): V3Pool {
  const fee = 500 // 0.05% fee
  const sqrtPriceX96 = encodeSqrtRatioX96(1, 1)
  const liquidity = '1000000000000000000000'
  const tick = 0

  return new V3Pool(token0, token1, fee, sqrtPriceX96, liquidity, tick)
}

export function toCurrencyAmount(token: AnyToken, amount: BigNumber) {
  return CurrencyAmount.fromRawAmount(token, amount.toString())
}

type IRoute =
  | RouteV2<Token, Token>
  | RouteV3<Token, Token>
  | IntegralRoute<Token, Token>
  | IntegralBoostedRoute<AnyToken, AnyToken>

function getProtocolTypeByRoute(route: IRoute): Protocol {
  if (route instanceof RouteV2) {
    return Protocol.V2
  } else if (route instanceof RouteV3) {
    return Protocol.V3
  } else if (route instanceof IntegralBoostedRoute) {
    return Protocol.INTEGRAL_BOOSTED
  } else if (route instanceof IntegralRoute) {
    return Protocol.INTEGRAL
  } else {
    return Protocol.MIXED
  }
}

/**
 * Creates an OmegaTrade for Integral swaps
 */
export function createOmegaTrade(
  route: IRoute,
  amountIn: BigNumber,
  amountOut: BigNumber,
  tradeType: TradeType
): OmegaTrade<AnyToken, AnyToken, TradeType> {
  const protocol = getProtocolTypeByRoute(route)
  const tokenIn = route.input
  const tokenOut = route.output
  const inputAmount = toCurrencyAmount(tokenIn, amountIn)
  const outputAmount = toCurrencyAmount(tokenOut, amountOut)

  let v2Routes = undefined
  let v3Routes = undefined
  let integralRoutes = undefined
  let integralBoostedRoutes = undefined

  switch (protocol) {
    case Protocol.V2: {
      v2Routes = [
        {
          inputAmount,
          outputAmount,
          route: route as RouteV2<Token, Token>,
        },
      ]
      break
    }
    case Protocol.V3: {
      v3Routes = [
        {
          inputAmount,
          outputAmount,
          route: route as RouteV3<Token, Token>,
        },
      ]
      break
    }

    case Protocol.INTEGRAL_BOOSTED: {
      integralBoostedRoutes = [
        {
          inputAmount,
          outputAmount,
          route: route as IntegralBoostedRoute<AnyToken, AnyToken>,
        },
      ]
      break
    }

    case Protocol.INTEGRAL: {
      integralRoutes = [
        {
          inputAmount,
          outputAmount,
          route: route as IntegralRoute<AnyToken, AnyToken>,
        },
      ]
      break
    }

    case Protocol.MIXED:
      throw new Error('Only Integral protocol is supported in this helper function')
  }

  return new OmegaTrade({
    v2Routes,
    v3Routes,
    integralRoutes,
    integralBoostedRoutes,
    tradeType,
  })
}

export function expandTo18DecimalsBN(n: number): BigNumber {
  // Handle decimal numbers by converting to string with full precision
  const str = n.toString()
  const parts = str.split('.')
  const wholePart = parts[0] || '0'
  const decimalPart = parts[1] || ''

  // Pad or truncate decimal part to 18 digits
  const paddedDecimal = decimalPart.padEnd(18, '0').slice(0, 18)
  const combined = wholePart + paddedDecimal

  return BigNumber.from(combined)
}

export function expandTo6DecimalsBN(n: number): BigNumber {
  // Handle decimal numbers by converting to string with full precision
  const str = n.toString()
  const parts = str.split('.')
  const wholePart = parts[0] || '0'
  const decimalPart = parts[1] || ''

  // Pad or truncate decimal part to 6 digits
  const paddedDecimal = decimalPart.padEnd(6, '0').slice(0, 6)
  const combined = wholePart + paddedDecimal

  return BigNumber.from(combined)
}

export function expand6To18DecimalsBN(n: BigNumber): BigNumber {
  return n.mul(BigNumber.from(10).pow(12))
}

export const getMinTick = (tickSpacing: number) => Math.ceil(-887272 / tickSpacing) * tickSpacing
export const getMaxTick = (tickSpacing: number) => Math.floor(887272 / tickSpacing) * tickSpacing
export const getMaxLiquidityPerTick = (tickSpacing: number) =>
  BigNumber.from(2)
    .pow(128)
    .sub(1)
    .div((getMaxTick(tickSpacing) - getMinTick(tickSpacing)) / tickSpacing + 1)

export function encodePriceSqrt(reserve1: BigNumberish, reserve0: BigNumberish): BigNumber {
  return BigNumber.from(encodeSqrtRatioX96(reserve1.toString(), reserve0.toString()).toString())
}
