import {
  Currency,
  encodeRouteToPath as encodeIntegralRouteToPath,
  Route as IntegralRoute,
  BoostedRoute as IntegralBoostedRoute,
  BoostedRouteStep,
  BoostedRouteStepType,
} from '@cryptoalgebra/integral-sdk'
import { Route as V2Route } from '@uniswap/v2-sdk'
import { Route as V3Route, encodeRouteToPath as encodeV3RouteToPath } from '@uniswap/v3-sdk'
import { Hex, Address, encodeAbiParameters, decodeAbiParameters } from 'viem'
import { QuoterCommandType } from './quoterCommands'
import { QuoterCommands } from '../types/quoter'
import { encodeBoostedRouteExactOutput, encodeIntegralExactOut } from './encodePath'
import { CONTRACT_BALANCE } from '../constants'
import { Protocol } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE TYPES
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// ABI PARAMETER TYPES
// ═══════════════════════════════════════════════════════════════════════════

const AMOUNT_PATH_PARAMS = [
  { name: 'amount', type: 'uint256' },
  { name: 'path', type: 'bytes' },
] as const

const ADDRESS_AMOUNT_PARAMS = [
  { name: 'address', type: 'address' },
  { name: 'amount', type: 'uint256' },
] as const

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND ENCODING
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// PROTOCOL-SPECIFIC ENCODERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build quoter commands for V2 route
 */
export function buildV2QuoterCommands(
  route: V2Route<Currency, Currency>,
  amount: bigint,
  exactInput: boolean
): QuoterCommands {
  const path = route.path.map((token) => token.wrapped.address)
  // V2 path is reversed for exactOutput
  const encodedPath = exactInput ? path : [...path].reverse()
  const pathHex = ('0x' + encodedPath.map((addr) => addr.slice(2).toLowerCase()).join('')) as Hex

  const command = exactInput ? QuoterCommandType.V2_SWAP_EXACT_IN : QuoterCommandType.V2_SWAP_EXACT_OUT

  return {
    commands: commandsToHex([command]),
    inputs: [encodeSwapInput(amount, pathHex)],
  }
}

/**
 * Build quoter commands for V3 route
 */
export function buildV3QuoterCommands(
  route: V3Route<Currency, Currency>,
  amount: bigint,
  exactInput: boolean
): QuoterCommands {
  const path = encodeV3RouteToPath(route, !exactInput) as Hex
  const command = exactInput ? QuoterCommandType.UNISWAP_V3_SWAP_EXACT_IN : QuoterCommandType.UNISWAP_V3_SWAP_EXACT_OUT

  return {
    commands: commandsToHex([command]),
    inputs: [encodeSwapInput(amount, path)],
  }
}

/**
 * Build quoter commands for Integral route
 */
export function buildIntegralQuoterCommands(
  route: IntegralRoute<Currency, Currency>,
  amount: bigint,
  exactInput: boolean
): QuoterCommands {
  // ExactInput uses standard path encoding, ExactOut uses boosted path format
  const path = exactInput ? (encodeIntegralRouteToPath(route, false) as Hex) : (encodeIntegralExactOut(route) as Hex)
  const command = exactInput ? QuoterCommandType.INTEGRAL_SWAP_EXACT_IN : QuoterCommandType.INTEGRAL_SWAP_EXACT_OUT

  return {
    commands: commandsToHex([command]),
    inputs: [encodeSwapInput(amount, path)],
  }
}

/**
 * Build quoter commands for Boosted route (ExactInput)
 * Processes steps forward with step-by-step commands
 */
export function buildBoostedExactInQuoterCommands(
  route: IntegralBoostedRoute<Currency, Currency>,
  amount: bigint
): QuoterCommands {
  const { steps } = route
  const commands: number[] = []
  const inputs: Hex[] = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepAmount = i === 0 ? amount : CONTRACT_BALANCE
    const { command, input } = encodeBoostedStep(step, stepAmount, true)
    commands.push(command)
    inputs.push(input)
  }

  return {
    commands: commandsToHex(commands),
    inputs,
  }
}

/**
 * Build quoter commands for Boosted route (ExactOutput)
 * Uses single INTEGRAL_SWAP_EXACT_OUT with encoded path
 */
export function buildBoostedExactOutQuoterCommands(
  route: IntegralBoostedRoute<Currency, Currency>,
  amount: bigint
): QuoterCommands {
  const path = encodeBoostedRouteExactOutput(route) as Hex

  return {
    commands: commandsToHex([QuoterCommandType.INTEGRAL_SWAP_EXACT_OUT]),
    inputs: [encodeSwapInput(amount, path)],
  }
}

/**
 * Encode a single boosted step for quoter
 */
function encodeBoostedStep(
  step: BoostedRouteStep,
  amount: bigint,
  exactInput: boolean
): { command: number; input: Hex } {
  switch (step.type) {
    case BoostedRouteStepType.WRAP: {
      const wrapper = step.tokenOut.address as Address
      return {
        command: QuoterCommandType.ERC4626_WRAP,
        input: encodeWrapInput(wrapper, amount),
      }
    }

    case BoostedRouteStepType.UNWRAP: {
      const wrapper = step.tokenIn.address as Address
      return {
        command: QuoterCommandType.ERC4626_UNWRAP,
        input: encodeWrapInput(wrapper, amount),
      }
    }

    case BoostedRouteStepType.SWAP: {
      const swapRoute = new IntegralRoute([step.pool], step.tokenIn, step.tokenOut)
      const path = encodeIntegralRouteToPath(swapRoute, !exactInput) as Hex
      return {
        command: exactInput ? QuoterCommandType.INTEGRAL_SWAP_EXACT_IN : QuoterCommandType.INTEGRAL_SWAP_EXACT_OUT,
        input: encodeSwapInput(amount, path),
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL COMMAND BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build quoter commands for any route type.
 * Automatically detects route type from instance.
 */
export function buildQuoterCommands(route: AnyRoute, amount: bigint, exactInput: boolean): QuoterCommands {
  const routeType = getRouteType(route)

  switch (routeType) {
    case Protocol.V2:
      return buildV2QuoterCommands(route as V2Route<Currency, Currency>, amount, exactInput)

    case Protocol.V3:
      return buildV3QuoterCommands(route as V3Route<Currency, Currency>, amount, exactInput)

    case Protocol.INTEGRAL:
      return buildIntegralQuoterCommands(route as IntegralRoute<Currency, Currency>, amount, exactInput)

    case Protocol.INTEGRAL_BOOSTED: {
      const boostedRoute = route as IntegralBoostedRoute<Currency, Currency>
      return exactInput
        ? buildBoostedExactInQuoterCommands(boostedRoute, amount)
        : buildBoostedExactOutQuoterCommands(boostedRoute, amount)
    }

    default:
      throw new Error(`Unsupported route type: ${routeType}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT PARSING TYPES AND FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

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
