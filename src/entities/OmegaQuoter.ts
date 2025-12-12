import {
  Currency,
  CurrencyAmount,
  BoostedRoute as IntegralBoostedRoute,
  BoostedRouteStepType,
  Route as IntegralRoute,
  encodeRouteToPath as encodeIntegralRouteToPath,
  type BoostedRouteStep,
} from '@cryptoalgebra/integral-sdk'
import { Route as V2Route } from '@uniswap/v2-sdk'
import { Route as V3Route, encodeRouteToPath as encodeV3RouteToPath } from '@uniswap/v3-sdk'
import { Address, Hex, PublicClient } from 'viem'
import { omegaQuoterAbi } from '../abis'
import {
  decodeSwapOutput,
  decodeAmountOutput,
  getRouteType,
  encodeSwapInput,
  encodeWrapInput,
  commandsToHex,
  type AnyRoute,
} from '../utils/quoterEncoder'
import {
  QuoteResult,
  MulticallResult,
  QuoterCommands,
  SimulateContractResult,
  QuoterContractCall,
} from '../types/quoter'
import { QuoterCommandType } from '../utils/quoterCommands'
import { encodeBoostedRouteExactOutput, encodeIntegralExactOut } from '../utils/encodePath'
import { CONTRACT_BALANCE } from '../constants'
import { Protocol } from '../types'

/**
 * OmegaQuoter — calculates quotes for all route types.
 * Supports V2, V3, Integral, and Integral Boosted routes.
 *
 * Can be used in two ways:
 * 1. Instance methods: new OmegaQuoter(client, address).quote(route, amount, exactInput)
 * 2. Static methods: OmegaQuoter.buildCommands(route, amount, exactInput) for external use
 */
export class OmegaQuoter {
  private readonly client: PublicClient
  private readonly quoterAddress: Address

  constructor(client: PublicClient, quoterAddress: Address) {
    this.client = client
    this.quoterAddress = quoterAddress
  }

  /**
   * Build quoter commands for any route type.
   * Automatically detects route type from instance.
   */
  static buildCommands(route: AnyRoute, amount: bigint, exactInput: boolean): QuoterCommands {
    const routeType = getRouteType(route)

    switch (routeType) {
      case Protocol.V2:
        return OmegaQuoter.buildV2QuoterCommands(route as V2Route<Currency, Currency>, amount, exactInput)

      case Protocol.V3:
        return OmegaQuoter.buildV3QuoterCommands(route as V3Route<Currency, Currency>, amount, exactInput)

      case Protocol.INTEGRAL:
        return OmegaQuoter.buildIntegralQuoterCommands(route as IntegralRoute<Currency, Currency>, amount, exactInput)

      case Protocol.INTEGRAL_BOOSTED: {
        const boostedRoute = route as IntegralBoostedRoute<Currency, Currency>

        return exactInput
          ? OmegaQuoter.buildBoostedExactInQuoterCommands(boostedRoute, amount)
          : OmegaQuoter.buildBoostedExactOutQuoterCommands(boostedRoute, amount)
      }

      default:
        throw new Error(`Unsupported route type: ${routeType}`)
    }
  }

  /**
   * Build quoter commands for V2 route
   */
  static buildV2Commands(route: V2Route<Currency, Currency>, amount: bigint, exactInput: boolean): QuoterCommands {
    return OmegaQuoter.buildV2QuoterCommands(route, amount, exactInput)
  }

  /**
   * Build quoter commands for V3 route
   */
  static buildV3Commands(route: V3Route<Currency, Currency>, amount: bigint, exactInput: boolean): QuoterCommands {
    return OmegaQuoter.buildV3QuoterCommands(route, amount, exactInput)
  }

  /**
   * Build quoter commands for Integral route
   */
  static buildIntegralCommands(
    route: IntegralRoute<Currency, Currency>,
    amount: bigint,
    exactInput: boolean
  ): QuoterCommands {
    return OmegaQuoter.buildIntegralQuoterCommands(route, amount, exactInput)
  }

  /**
   * Build quoter commands for Integral Boosted route
   */
  static buildIntegralBoostedCommands(
    route: IntegralBoostedRoute<Currency, Currency>,
    amount: bigint,
    exactInput: boolean
  ): QuoterCommands {
    return exactInput
      ? OmegaQuoter.buildBoostedExactInQuoterCommands(route, amount)
      : OmegaQuoter.buildBoostedExactOutQuoterCommands(route, amount)
  }

  /**
   * Parse raw quoter output into QuoteResult
   */
  static parseResult(route: AnyRoute, outputs: readonly Hex[], exactInput: boolean): QuoteResult {
    const routeType = getRouteType(route)

    switch (routeType) {
      case Protocol.V2:
      case Protocol.V3:
      case Protocol.INTEGRAL:
        return OmegaQuoter.parseSwapOutput(outputs[0], exactInput)

      case Protocol.INTEGRAL_BOOSTED: {
        const boostedRoute = route as IntegralBoostedRoute<Currency, Currency>
        return exactInput
          ? OmegaQuoter.parseBoostedExactInOutput(outputs, boostedRoute)
          : OmegaQuoter.parseSwapOutput(outputs[0], exactInput)
      }

      default:
        throw new Error(`Unsupported route type: ${routeType}`)
    }
  }

  /**
   * Get quote for a single route
   */
  async quote(route: AnyRoute, amount: CurrencyAmount<Currency>, exactInput: boolean): Promise<QuoteResult | null> {
    try {
      const amountRaw = BigInt(amount.quotient.toString())
      const { commands, inputs } = OmegaQuoter.buildCommands(route, amountRaw, exactInput)

      const { result } = await this.executeQuote(commands, inputs)

      return OmegaQuoter.parseResult(route, result, exactInput)
    } catch (error) {
      console.error('[OmegaQuoter] Quote error:', error)
      return null
    }
  }

  /**
   * Get quotes for multiple routes in a single multicall
   */
  async batchQuote(
    routes: AnyRoute[],
    amount: CurrencyAmount<Currency>,
    exactInput: boolean
  ): Promise<(QuoteResult | null)[]> {
    if (routes.length === 0) return []

    const amountRaw = BigInt(amount.quotient.toString())

    // Build calls for each route
    const calls = routes.map((route) => {
      const { commands, inputs } = OmegaQuoter.buildCommands(route, amountRaw, exactInput)
      return this.buildQuoterCall(commands, inputs)
    })

    // Execute multicall
    const results = await this.executeMulticall(calls)

    // Parse results
    return results.map((result, index) => {
      if (result.status === 'failure' || !result.result) {
        return null
      }

      try {
        return OmegaQuoter.parseResult(routes[index], result.result, exactInput)
      } catch {
        return null
      }
    })
  }

  /**
   * Execute quote via simulateContract
   */
  private async executeQuote(commands: Hex, inputs: Hex[]): Promise<SimulateContractResult> {
    return this.client.simulateContract({
      address: this.quoterAddress,
      abi: omegaQuoterAbi,
      functionName: 'execute',
      args: [commands, inputs],
    }) as Promise<SimulateContractResult>
  }

  /**
   * Build quoter call for multicall
   */
  private buildQuoterCall(commands: Hex, inputs: Hex[]): QuoterContractCall {
    return {
      address: this.quoterAddress,
      abi: omegaQuoterAbi,
      functionName: 'execute',
      args: [commands, inputs],
    }
  }

  /**
   * Execute multicall
   */
  private async executeMulticall(calls: QuoterContractCall[]): Promise<MulticallResult<readonly Hex[]>[]> {
    return this.client.multicall({
      contracts: calls,
      allowFailure: true,
    }) as Promise<MulticallResult<readonly Hex[]>[]>
  }

  /**
   * Parse swap output (V2, V3, Integral, Boosted ExactOut)
   */
  private static parseSwapOutput(output: Hex, exactInput: boolean): QuoteResult {
    const [amount, sqrtPrices, gasEstimate] = decodeSwapOutput(output)

    return [
      exactInput ? [amount] : [], // amountsOut
      exactInput ? [] : [amount], // amountsIn
      sqrtPrices.map(BigInt), // sqrtPrices
      [], // ticksCrossed
      gasEstimate, // gasEstimate
      [], // fees
    ]
  }

  /**
   * Parse boosted ExactIn output (multiple steps)
   */
  private static parseBoostedExactInOutput(
    outputs: readonly Hex[],
    route: IntegralBoostedRoute<Currency, Currency>
  ): QuoteResult {
    const { steps } = route

    const amountsOut: bigint[] = []
    const sqrtPrices: bigint[] = []
    let gasEstimate = 0n

    for (let i = 0; i < outputs.length; i++) {
      const step = steps[i]

      if (step.type === BoostedRouteStepType.SWAP) {
        const [amount, prices, gas] = decodeSwapOutput(outputs[i])

        amountsOut.push(amount)
        sqrtPrices.push(...prices.map(BigInt))
        gasEstimate += gas
      } else {
        // WRAP or UNWRAP
        const [amount] = decodeAmountOutput(outputs[i])

        amountsOut.push(amount)
        sqrtPrices.push(0n) // Placeholder for wrap/unwrap steps
      }
    }

    return [
      amountsOut, // amountsOut
      [], // amountsIn (ExactIn doesn't track input per step)
      sqrtPrices, // sqrtPrices
      [], // ticksCrossed
      gasEstimate, // gasEstimate
      [], // fees
    ]
  }

  /**
   * Build quoter commands for V2 route
   */
  private static buildV2QuoterCommands(
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
  private static buildV3QuoterCommands(
    route: V3Route<Currency, Currency>,
    amount: bigint,
    exactInput: boolean
  ): QuoterCommands {
    const path = encodeV3RouteToPath(route, !exactInput) as Hex
    const command = exactInput
      ? QuoterCommandType.UNISWAP_V3_SWAP_EXACT_IN
      : QuoterCommandType.UNISWAP_V3_SWAP_EXACT_OUT

    return {
      commands: commandsToHex([command]),
      inputs: [encodeSwapInput(amount, path)],
    }
  }

  /**
   * Build quoter commands for Integral route
   */
  private static buildIntegralQuoterCommands(
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
  private static buildBoostedExactInQuoterCommands(
    route: IntegralBoostedRoute<Currency, Currency>,
    amount: bigint
  ): QuoterCommands {
    const { steps } = route
    const commands: number[] = []
    const inputs: Hex[] = []

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const stepAmount = i === 0 ? amount : CONTRACT_BALANCE
      const { command, input } = OmegaQuoter.encodeBoostedStep(step, stepAmount, true)
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
  private static buildBoostedExactOutQuoterCommands(
    route: IntegralBoostedRoute<Currency, Currency>,
    amount: bigint
  ): QuoterCommands {
    // if wrap or unwrap
    if (route.pools.length === 0) {
      const step = route.steps[0]
      const { command, input } = OmegaQuoter.encodeBoostedStep(step, amount, false)

      return {
        commands: commandsToHex([command]),
        inputs: [input],
      }
    }

    const path = encodeBoostedRouteExactOutput(route) as Hex

    return {
      commands: commandsToHex([QuoterCommandType.INTEGRAL_SWAP_EXACT_OUT]),
      inputs: [encodeSwapInput(amount, path)],
    }
  }

  /**
   * Encode a single boosted step for quoter
   */
  private static encodeBoostedStep(
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
}
