import {
  Currency,
  TradeType,
  Route as IntegralRoute,
  encodeRouteToPath as encodeIntegralRouteToPath,
  BoostedRoute,
  BoostedRouteStepType,
  CurrencyAmount,
  Pool as IntegralPool,
} from '@cryptoalgebra/integral-sdk'
import { Pair } from '@uniswap/v2-sdk'
import { Pool as V3Pool, encodeRouteToPath as encodeV3RouteToPath } from '@uniswap/v3-sdk'
import { CommandType, RoutePlanner } from './../utils/routerCommands'
import { Command, RouterActionType, TradeConfig } from '../types/command'
import { ADDRESS_THIS, CONTRACT_BALANCE, SOURCE_ROUTER, MSG_SENDER } from './../constants'
import { OmegaTrade } from './OmegaTrade'
import { IRoute, Protocol, RouteIntegral, RouteV2, RouteV3 } from '../types'
import { encodeBoostedRouteExactOutput, encodeIntegralExactOut } from '../utils/encodePath'
import { OmegaSwapOptions } from '../types/options'

// Type for individual swap within trade
interface Swap<TInput extends Currency, TOutput extends Currency> {
  route: IRoute<TInput, TOutput, Pair | V3Pool | IntegralPool>
  inputAmount: CurrencyAmount<TInput>
  outputAmount: CurrencyAmount<TOutput>
}

const SENDER_AS_RECIPIENT = MSG_SENDER
const ROUTER_AS_RECIPIENT = ADDRESS_THIS

/**
 * OmegaEncoder — universal encoder for multi-protocol trades.
 * Supports V2, V3, Integral, and Integral Boosted routes with automatic wrap/unwrap.
 */
export class OmegaEncoder implements Command {
  readonly tradeType: RouterActionType = RouterActionType.OmegaEncoder
  readonly trade: OmegaTrade<Currency, Currency, TradeType>
  readonly options: OmegaSwapOptions

  constructor(trade: OmegaTrade<Currency, Currency, TradeType>, options: OmegaSwapOptions) {
    this.trade = trade
    this.options = options
  }

  /**
   * Check if input token needs to be wrapped (ETH -> WETH)
   */
  get inputRequiresWrap(): boolean {
    return this.trade.inputAmount.currency.isNative
  }

  /**
   * Check if output token needs to be unwrapped (WETH -> ETH)
   */
  get outputRequiresUnwrap(): boolean {
    return this.trade.outputAmount.currency.isNative
  }

  /**
   * Main encode — adds commands to planner.
   * Iterates over all swaps and encodes each based on its protocol.
   */
  public encode(planner: RoutePlanner, _config?: TradeConfig) {
    // Wrap ETH if needed (for all routes that need wrapped input)
    if (this.inputRequiresWrap) {
      const wrapAmount = this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString()
      planner.addCommand(CommandType.WRAP_ETH, [ROUTER_AS_RECIPIENT, wrapAmount])
      console.log(`[WRAP_ETH]: { recipient: ${ROUTER_AS_RECIPIENT}, amount: ${wrapAmount} }`)
    } else {
      const transferAmount = this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString()
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
        this.trade.inputAmount.currency.wrapped.address,
        ROUTER_AS_RECIPIENT,
        transferAmount,
      ])
      console.log(
        `[PERMIT2_TRANSFER_FROM]: { token: ${this.trade.inputAmount.currency.wrapped.address}, recipient: ${ROUTER_AS_RECIPIENT}, amount: ${transferAmount} }`
      )
    }

    // Set default recipient
    this.options.recipient = this.options.recipient ?? SENDER_AS_RECIPIENT

    // Flag for aggregated slippage check
    const performAggregatedSlippageCheck =
      this.trade.tradeType === TradeType.EXACT_INPUT && this.trade.routes.length > 2
    const routerMustCustody = performAggregatedSlippageCheck || this.outputRequiresUnwrap

    // Encode each swap based on its protocol
    for (const swap of this.trade.swaps) {
      const route = swap.route

      switch (route.protocol) {
        case Protocol.V2:
          this.addV2Swap(planner, swap as Swap<Currency, Currency>, routerMustCustody)
          break
        case Protocol.V3:
          this.addV3Swap(planner, swap as Swap<Currency, Currency>, routerMustCustody)
          break
        case Protocol.INTEGRAL:
          this.addIntegralSwap(planner, swap as Swap<Currency, Currency>, routerMustCustody)
          break
        case Protocol.INTEGRAL_BOOSTED:
          this.addIntegralBoostedSwap(planner, swap as Swap<Currency, Currency>, routerMustCustody)
          break
        case Protocol.MIXED:
          // TODO: Implement mixed route support
          throw new Error('Mixed routes are not yet supported')
        default:
          throw new Error(`Unsupported protocol: ${route.protocol}`)
      }
    }

    // Handle output unwrap if needed
    if (routerMustCustody) {
      if (this.outputRequiresUnwrap) {
        const minimumAmountOut = this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()
        planner.addCommand(CommandType.UNWRAP_WETH, [this.options.recipient, minimumAmountOut])
        console.log(`[UNWRAP_WETH]: { recipient: ${this.options.recipient}, minAmountOut: ${minimumAmountOut} }`)
      } else if (performAggregatedSlippageCheck) {
        // Sweep output token to recipient with slippage check
        const minimumAmountOut = this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()
        const tokenAddress = this.trade.outputAmount.currency.wrapped.address
        planner.addCommand(CommandType.SWEEP, [tokenAddress, this.options.recipient, minimumAmountOut])
        console.log(
          `[SWEEP]: { token: ${tokenAddress}, recipient: ${this.options.recipient}, minAmount: ${minimumAmountOut} }`
        )
      }
    }

    // For exact output swaps, sweep unused input back to user
    if (this.trade.tradeType === TradeType.EXACT_OUTPUT) {
      if (this.inputRequiresWrap) {
        // Unwrap unused WETH back to ETH and send to user
        planner.addCommand(CommandType.UNWRAP_WETH, [this.options.recipient, 0])
        console.log(`[UNWRAP_WETH]: { recipient: ${this.options.recipient}, minAmountOut: 0 }`)
      } else {
        // Sweep unused input tokens back to user
        const tokenAddress = this.trade.inputAmount.currency.wrapped.address
        planner.addCommand(CommandType.SWEEP, [tokenAddress, this.options.recipient, 0])
        console.log(`[SWEEP]: { token: ${tokenAddress}, recipient: ${this.options.recipient}, minAmount: 0 }`)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // V2 SWAP
  // ═══════════════════════════════════════════════════════════════════════════

  private addV2Swap(
    planner: RoutePlanner,
    { route, inputAmount, outputAmount }: Swap<Currency, Currency>,
    routerMustCustody: boolean
  ): void {
    const v2Route = route as RouteV2<Currency, Currency>

    if (this.trade.tradeType === TradeType.EXACT_INPUT) {
      const recipient = routerMustCustody ? ROUTER_AS_RECIPIENT : this.options.recipient
      const minAmountOut = routerMustCustody
        ? 0
        : this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()
      const path = v2Route.path.map((token) => token.wrapped.address)
      planner.addCommand(CommandType.V2_SWAP_EXACT_IN, [
        recipient,
        inputAmount.quotient.toString(),
        minAmountOut,
        path,
        SOURCE_ROUTER,
      ])
      console.log(
        `[V2_SWAP_EXACT_IN]: { recipient: ${recipient}, inputAmount: ${inputAmount.quotient.toString()}, minAmountOut: ${minAmountOut}, path: ${path.join(
          ' -> '
        )}, payerIsUser: ${SOURCE_ROUTER} }`
      )
    } else {
      const recipient = routerMustCustody ? ROUTER_AS_RECIPIENT : this.options.recipient
      const maxAmountIn = this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString()
      const path = v2Route.path.map((token) => token.wrapped.address)
      planner.addCommand(CommandType.V2_SWAP_EXACT_OUT, [
        recipient,
        outputAmount.quotient.toString(),
        maxAmountIn,
        path,
        SOURCE_ROUTER,
      ])
      console.log(
        `[V2_SWAP_EXACT_OUT]: { recipient: ${recipient}, outputAmount: ${outputAmount.quotient.toString()}, maxAmountIn: ${maxAmountIn}, path: ${path.join(
          ' -> '
        )}, payerIsUser: ${SOURCE_ROUTER} }`
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // V3 SWAP (Uniswap V3)
  // ═══════════════════════════════════════════════════════════════════════════

  private addV3Swap(
    planner: RoutePlanner,
    { route, inputAmount, outputAmount }: Swap<Currency, Currency>,
    routerMustCustody: boolean
  ): void {
    const v3Route = route as RouteV3<Currency, Currency>
    const path = encodeV3RouteToPath(v3Route, this.trade.tradeType === TradeType.EXACT_OUTPUT)

    if (this.trade.tradeType === TradeType.EXACT_INPUT) {
      const recipient = routerMustCustody ? ROUTER_AS_RECIPIENT : this.options.recipient
      const minAmountOut = routerMustCustody
        ? 0
        : this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_IN, [
        recipient,
        inputAmount.quotient.toString(),
        minAmountOut,
        path,
        SOURCE_ROUTER,
      ])
      console.log(
        `[UNISWAP_V3_SWAP_EXACT_IN]: { recipient: ${recipient}, inputAmount: ${inputAmount.quotient.toString()}, minAmountOut: ${minAmountOut}, path: ${path}, payerIsUser: ${SOURCE_ROUTER} }`
      )
    } else {
      const recipient = routerMustCustody ? ROUTER_AS_RECIPIENT : this.options.recipient
      const maxAmountIn = this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString()
      planner.addCommand(CommandType.UNISWAP_V3_SWAP_EXACT_OUT, [
        recipient,
        outputAmount.quotient.toString(),
        maxAmountIn,
        path,
        SOURCE_ROUTER,
      ])
      console.log(
        `[UNISWAP_V3_SWAP_EXACT_OUT]: { recipient: ${recipient}, outputAmount: ${outputAmount.quotient.toString()}, maxAmountIn: ${maxAmountIn}, path: ${path}, payerIsUser: ${SOURCE_ROUTER} }`
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRAL SWAP (Regular, non-boosted)
  // ═══════════════════════════════════════════════════════════════════════════

  private addIntegralSwap(
    planner: RoutePlanner,
    { route, inputAmount, outputAmount }: Swap<Currency, Currency>,
    routerMustCustody: boolean
  ): void {
    const integralRoute = route as unknown as RouteIntegral<Currency, Currency>

    if (this.trade.tradeType === TradeType.EXACT_INPUT) {
      const path = encodeIntegralRouteToPath(integralRoute, false)
      const recipient = routerMustCustody ? ROUTER_AS_RECIPIENT : this.options.recipient
      const minAmountOut = routerMustCustody
        ? 0
        : this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        recipient,
        inputAmount.quotient.toString(),
        minAmountOut,
        path,
        SOURCE_ROUTER,
      ])
      console.log(
        `[INTEGRAL_SWAP_EXACT_IN]: { recipient: ${recipient}, inputAmount: ${inputAmount.quotient.toString()}, minAmountOut: ${minAmountOut}, path: ${path}, payerIsUser: ${SOURCE_ROUTER} }`
      )
    } else {
      const path = encodeIntegralExactOut(integralRoute)
      const recipient = routerMustCustody ? ROUTER_AS_RECIPIENT : this.options.recipient
      const maxAmountIn = this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString()
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        recipient,
        outputAmount.quotient.toString(),
        maxAmountIn,
        path,
        SOURCE_ROUTER,
      ])
      console.log(
        `[INTEGRAL_SWAP_EXACT_OUT]: { recipient: ${recipient}, outputAmount: ${outputAmount.quotient.toString()}, maxAmountIn: ${maxAmountIn}, path: ${path}, payerIsUser: ${SOURCE_ROUTER} }`
      )
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRAL BOOSTED SWAP (with ERC4626 wrap/unwrap)
  // ═══════════════════════════════════════════════════════════════════════════

  private addIntegralBoostedSwap(
    planner: RoutePlanner,
    swap: Swap<Currency, Currency>,
    routerMustCustody: boolean
  ): void {
    const route = swap.route as unknown as BoostedRoute<Currency, Currency>
    const exactInput = this.trade.tradeType === TradeType.EXACT_INPUT

    if (exactInput) {
      this.encodeBoostedExactInput(planner, route, swap, routerMustCustody)
    } else {
      this.encodeBoostedExactOutput(planner, route, swap, routerMustCustody)
    }
  }

  /**
   * ExactInput: Process steps forward, each step output feeds into next step input
   */
  private encodeBoostedExactInput(
    planner: RoutePlanner,
    route: BoostedRoute<Currency, Currency>,
    swap: Swap<Currency, Currency>,
    routerMustCustody: boolean
  ) {
    const { steps } = route
    const recipient = routerMustCustody ? ROUTER_AS_RECIPIENT : this.options.recipient!
    const amount = BigInt(swap.inputAmount.quotient.toString())
    const minAmountOut = routerMustCustody
      ? BigInt(0)
      : BigInt(this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString())

    const isOutputNative = route.output.isNative

    const shouldUnwrapOutput = isOutputNative && !routerMustCustody

    // Process each step
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const isFirstStep = i === 0
      const isLastStep = i === steps.length - 1

      const stepRecipient = isLastStep ? (shouldUnwrapOutput ? ADDRESS_THIS : recipient) : ADDRESS_THIS
      const stepAmount = isFirstStep ? amount : CONTRACT_BALANCE
      const stepMinAmountOut = isLastStep ? minAmountOut : BigInt(0)

      switch (step.type) {
        case BoostedRouteStepType.WRAP:
          planner.addCommand(CommandType.ERC4626_WRAP, [
            step.tokenOut.address,
            step.tokenIn.address,
            stepRecipient,
            stepAmount,
            stepMinAmountOut,
          ])
          console.log(
            `[ERC4626_WRAP]: { vault: ${step.tokenOut.address}, underlying: ${step.tokenIn.address}, recipient: ${stepRecipient}, amountIn: ${stepAmount}, minAmountOut: ${stepMinAmountOut} }`
          )
          break

        case BoostedRouteStepType.UNWRAP:
          planner.addCommand(CommandType.ERC4626_UNWRAP, [
            step.tokenIn.address,
            stepRecipient,
            stepAmount,
            stepMinAmountOut,
          ])
          console.log(
            `[ERC4626_UNWRAP]: { vault: ${step.tokenIn.address}, recipient: ${stepRecipient}, amountIn: ${stepAmount}, minAmountOut: ${stepMinAmountOut} }`
          )
          break

        case BoostedRouteStepType.SWAP: {
          const route = new IntegralRoute([step.pool], step.tokenIn, step.tokenOut)
          const path = encodeIntegralRouteToPath(route, false)
          planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
            stepRecipient,
            stepAmount,
            stepMinAmountOut,
            path,
            SOURCE_ROUTER,
          ])
          console.log(
            `[INTEGRAL_SWAP_EXACT_IN]: { recipient: ${stepRecipient}, inputAmount: ${stepAmount}, minAmountOut: ${stepMinAmountOut}, path: ${path}, payerIsUser: false }`
          )
          break
        }
      }
    }

    // Unwrap output to native if needed (only if router doesn't need to custody)
    if (shouldUnwrapOutput) {
      planner.addCommand(CommandType.UNWRAP_WETH, [this.options.recipient, 0])
      console.log(`[UNWRAP_WETH]: { recipient: ${this.options.recipient}, minAmountOut: 0 }`)
    }
  }

  /**
   * ExactOutput for boosted routes - uses single INTEGRAL_SWAP_EXACT_OUT command with encoded path.
   * The path encodes all wrap/unwrap operations directly, router handles them internally.
   */
  private encodeBoostedExactOutput(
    planner: RoutePlanner,
    route: BoostedRoute<Currency, Currency>,
    swap: Swap<Currency, Currency>,
    routerMustCustody: boolean
  ) {
    const recipient = routerMustCustody ? ROUTER_AS_RECIPIENT : this.options.recipient!
    const amountOut = BigInt(swap.outputAmount.quotient.toString())
    const maxAmountIn = BigInt(this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString())

    // Build the boosted path from route steps
    const path = encodeBoostedRouteExactOutput(route)

    // Single command handles all wrap/unwrap/swap operations
    planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [recipient, amountOut, maxAmountIn, path, SOURCE_ROUTER])
    console.log(
      `[INTEGRAL_SWAP_EXACT_OUT]: { recipient: ${recipient}, amountOut: ${amountOut}, maxAmountIn: ${maxAmountIn}, path: ${path}, payerIsUser: ${SOURCE_ROUTER} }`
    )
  }
}
