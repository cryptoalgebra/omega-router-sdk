import {
  ADDRESS_ZERO,
  BoostedRoute,
  BoostedRouteStepSwap,
  BoostedRouteStepType,
  Currency,
  Route as IntegralRoute,
} from '@cryptoalgebra/integral-sdk'

// WrapAction enum values
export const WrapAction = {
  NONE: 0,
  WRAP: 1,
  UNWRAP: 2,
} as const

export type WrapActionType = (typeof WrapAction)[keyof typeof WrapAction]

export interface BoostedPoolHop {
  tokenOut: string // External token user wants
  wrapOut: WrapActionType // Action for output: NONE, WRAP, UNWRAP
  poolTokenOut: string // Token pool trades (may be wrapped version)
  deployer: string // Pool deployer address
  poolTokenIn: string // Token pool accepts as input
  wrapIn: WrapActionType // Action for input: NONE, WRAP, UNWRAP
  tokenIn: string // External token user provides
}

/**
 * Encodes a boosted path for exactOut swaps with wrap/unwrap support
 *
 * Path structure per hop: tokenOut(20) | wrapOut(1) | poolTokenOut(20) | deployer(20) | poolTokenIn(20) | wrapIn(1) | tokenIn(20)
 *
 * For multihop, the tokenIn of one hop becomes the tokenOut of the next hop
 */
export function encodeBoostedPathExactOutput(hops: BoostedPoolHop[]): string {
  let encoded = '0x'

  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i]

    // tokenOut (20 bytes)
    encoded += hop.tokenOut.slice(2).toLowerCase()
    // wrapOut (1 byte)
    encoded += hop.wrapOut.toString(16).padStart(2, '0')
    // poolTokenOut (20 bytes)
    encoded += hop.poolTokenOut.slice(2).toLowerCase()
    // deployer (20 bytes)
    encoded += hop.deployer.slice(2).toLowerCase()
    // poolTokenIn (20 bytes)
    encoded += hop.poolTokenIn.slice(2).toLowerCase()
    // wrapIn (1 byte)
    encoded += hop.wrapIn.toString(16).padStart(2, '0')

    // tokenIn (20 bytes) - only for last hop, otherwise it's encoded as tokenOut of next hop
    if (i === hops.length - 1) {
      encoded += hop.tokenIn.slice(2).toLowerCase()
    }
  }

  return encoded
}

/**
 * Helper to create a single-hop boosted path for exactOut
 */
export function encodeSingleBoostedPoolExactOutput(
  tokenOut: string,
  wrapOut: WrapActionType,
  poolTokenOut: string,
  deployer: string,
  poolTokenIn: string,
  wrapIn: WrapActionType,
  tokenIn: string
): string {
  return encodeBoostedPathExactOutput([
    {
      tokenOut,
      wrapOut,
      poolTokenOut,
      deployer,
      poolTokenIn,
      wrapIn,
      tokenIn,
    },
  ])
}

/**
 * Helper to create a simple boosted path for exactOut without any wrap/unwrap
 * tokenIn == poolTokenIn and tokenOut == poolTokenOut
 *
 * @param tokens Array of token addresses in swap order (e.g., [tokenIn, tokenOut] for single hop)
 * @param deployer Pool deployer address (defaults to ZERO_ADDRESS)
 */
export function encodeSimpleBoostedPathExactOutput(tokens: string[], deployer: string = ADDRESS_ZERO): string {
  // Reverse tokens for exactOut (path goes from output to input)
  const reversedTokens = tokens.slice().reverse()

  const hops: BoostedPoolHop[] = []

  for (let i = 0; i < reversedTokens.length - 1; i++) {
    const tokenOut = reversedTokens[i]
    const tokenIn = reversedTokens[i + 1]

    hops.push({
      tokenOut,
      wrapOut: WrapAction.NONE,
      poolTokenOut: tokenOut, // same as tokenOut (no wrap)
      deployer,
      poolTokenIn: tokenIn, // same as tokenIn (no wrap)
      wrapIn: WrapAction.NONE,
      tokenIn,
    })
  }

  return encodeBoostedPathExactOutput(hops)
}

/**
 * Build boosted path for ExactOutput from BoostedRoute steps.
 * Converts steps to BoostedPoolHop format and encodes the path.
 */
export function encodeBoostedRouteExactOutput(route: BoostedRoute<Currency, Currency>): string {
  const { steps } = route
  const hops: BoostedPoolHop[] = []

  // Find all SWAP steps to identify hop boundaries
  const swapIndices: number[] = []
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].type === BoostedRouteStepType.SWAP) {
      swapIndices.push(i)
    }
  }

  // Process swaps in reverse order (ExactOutput path goes from output to input)
  for (let s = swapIndices.length - 1; s >= 0; s--) {
    const swapIdx = swapIndices[s]
    const swapStep = steps[swapIdx] as BoostedRouteStepSwap

    let wrapIn: WrapActionType = WrapAction.NONE
    let wrapOut: WrapActionType = WrapAction.NONE
    let tokenIn: string = swapStep.tokenIn.address
    let tokenOut: string = swapStep.tokenOut.address

    const stepBefore = swapIdx > 0 ? steps[swapIdx - 1] : null

    const stepAfter = swapIdx < steps.length - 1 ? steps[swapIdx + 1] : null

    // Check step after swap for output wrap action
    if (stepAfter?.type === BoostedRouteStepType.UNWRAP) {
      wrapOut = WrapAction.UNWRAP
      tokenOut = stepAfter.tokenOut.address // underlying token
    } else if (stepAfter?.type === BoostedRouteStepType.WRAP) {
      wrapOut = WrapAction.WRAP
      tokenOut = stepAfter.tokenOut.address // wrapped/boosted token
    }

    // Check step before swap for input wrap action
    if (stepBefore?.type === BoostedRouteStepType.WRAP) {
      wrapIn = WrapAction.WRAP
      tokenIn = stepBefore.tokenIn.address // underlying token
    } else if (stepBefore?.type === BoostedRouteStepType.UNWRAP) {
      wrapIn = WrapAction.UNWRAP
      tokenIn = stepBefore.tokenIn.address // wrapped/boosted token
    }

    // Pool tokens are what the pool actually trades
    const poolTokenIn = swapStep.tokenIn.address
    const poolTokenOut = swapStep.tokenOut.address

    const deployer = swapStep.pool?.deployer ?? ADDRESS_ZERO

    hops.push({
      tokenOut,
      wrapOut,
      poolTokenOut,
      deployer,
      poolTokenIn,
      wrapIn,
      tokenIn,
    })
  }

  return encodeBoostedPathExactOutput(hops)
}

/**
 * Encode IntegralRoute for ExactOutput using the boosted path format.
 * Regular Integral routes use WrapAction.NONE for all wrap operations.
 *
 * Path structure: tokenOut(20) | wrapOut(1) | poolTokenOut(20) | deployer(20) | poolTokenIn(20) | wrapIn(1) | tokenIn(20)
 */
export function encodeIntegralRouteExactOutput(route: IntegralRoute<Currency, Currency>): string {
  const { pools, tokenPath } = route
  const hops: BoostedPoolHop[] = []

  // For ExactOutput, we process pools in reverse order (from output to input)
  for (let i = pools.length - 1; i >= 0; i--) {
    const pool = pools[i]
    const tokenIn = tokenPath[i]
    const tokenOut = tokenPath[i + 1]

    const deployer = pool.deployer ?? ADDRESS_ZERO

    hops.push({
      tokenOut: tokenOut.address,
      wrapOut: WrapAction.NONE,
      poolTokenOut: tokenOut.address,
      deployer,
      poolTokenIn: tokenIn.address,
      wrapIn: WrapAction.NONE,
      tokenIn: tokenIn.address,
    })
  }

  return encodeBoostedPathExactOutput(hops)
}

/**
 * Universal encoder for Integral ExactOutput path.
 * Works with both IntegralRoute and BoostedRoute.
 * Automatically detects route type and encodes appropriately.
 */
export function encodeIntegralExactOut(
  route: IntegralRoute<Currency, Currency> | BoostedRoute<Currency, Currency>
): string {
  if (route.isBoosted) {
    return encodeBoostedRouteExactOutput(route as BoostedRoute<Currency, Currency>)
  }

  return encodeIntegralRouteExactOutput(route as IntegralRoute<Currency, Currency>)
}
