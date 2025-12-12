import { Currency, Route as IntegralRoute, BoostedRoute as IntegralBoostedRoute } from '@cryptoalgebra/integral-sdk'
import { Route as V2Route } from '@uniswap/v2-sdk'
import { Route as V3Route } from '@uniswap/v3-sdk'
import { Hex, Address, encodeAbiParameters, decodeAbiParameters } from 'viem'
import { Protocol } from '../types'

/**
 * Union type of all supported route types for quoter
 */
export type AnyRoute =
  | V2Route<Currency, Currency>
  | V3Route<Currency, Currency>
  | IntegralRoute<Currency, Currency>
  | IntegralBoostedRoute<Currency, Currency>

/**
 * Detect route type from route instance
 */
export function getRouteType(route: AnyRoute): Protocol {
  if (route instanceof V2Route) {
    return Protocol.V2
  }
  if (route instanceof V3Route) {
    return Protocol.V3
  }
  if (route instanceof IntegralRoute) {
    return Protocol.INTEGRAL
  }
  if (route instanceof IntegralBoostedRoute) {
    return Protocol.INTEGRAL_BOOSTED
  }

  throw new Error('Unknown route type')
}

const AMOUNT_PATH_PARAMS = [
  { name: 'amount', type: 'uint256' },
  { name: 'path', type: 'bytes' },
] as const

const ADDRESS_AMOUNT_PARAMS = [
  { name: 'address', type: 'address' },
  { name: 'amount', type: 'uint256' },
] as const

/**
 * Encode amount and path for swap commands
 */
export function encodeSwapInput(amount: bigint, path: Hex): Hex {
  return encodeAbiParameters(AMOUNT_PATH_PARAMS, [amount, path])
}

/**
 * Encode address and amount for wrap/unwrap commands
 */
export function encodeWrapInput(wrapper: Address, amount: bigint): Hex {
  return encodeAbiParameters(ADDRESS_AMOUNT_PARAMS, [wrapper, amount])
}

/**
 * Convert command array to hex string
 */
export function commandsToHex(commands: number[]): Hex {
  return ('0x' + commands.map((c) => c.toString(16).padStart(2, '0')).join('')) as Hex
}

export interface SwapQuoteOutput {
  amount: bigint
  sqrtPrices: bigint[]
  gasEstimate: bigint
}

export interface WrapQuoteOutput {
  amount: bigint
}

type SwapOutput = readonly [bigint, readonly bigint[], bigint]
type AmountOutput = readonly [bigint]

export function decodeSwapOutput(data: Hex): SwapOutput {
  return decodeAbiParameters(
    [
      { name: 'amount', type: 'uint256' },
      { name: 'sqrtPrices', type: 'uint160[]' },
      { name: 'gasEstimate', type: 'uint256' },
    ] as const,
    data
  ) as SwapOutput
}

export function decodeAmountOutput(data: Hex): AmountOutput {
  return decodeAbiParameters([{ name: 'amount', type: 'uint256' }] as const, data) as AmountOutput
}
