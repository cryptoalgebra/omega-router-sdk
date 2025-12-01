import {
  Currency,
  TradeType,
  SwapOptions as RouterSwapOptions,
  Trade,
  Route,
  encodeRouteToPath,
  BoostedRoute,
  BoostedRouteStep,
  BoostedRouteStepType,
} from '@cryptoalgebra/integral-sdk'
import { CommandType, RoutePlanner } from '../utils/routerCommands'
import { Command, RouterActionType } from './Command'
import { Permit2Permit } from '../utils/inputTokens'
import { ROUTER_ADDRESS, ADDRESS_THIS, CONTRACT_BALANCE, SOURCE_ROUTER } from '../constants'

// the existing router permit object doesn't include enough data for permit2
// so we extend swap options with the permit2 permit
export type SwapOptions = Omit<RouterSwapOptions, 'inputTokenPermit'> & {
  inputTokenPermit?: Permit2Permit

  /**
   * Expected output amounts for each step (ExactOutput boosted routes).
   * Array in execution order: [step0_out, step1_out, ..., final_out]
   * Calculate using quoter working backwards from desired output.
   */
  stepAmountsOut?: string[]
}

/**
 * OmegaTrade — universal class for regular and boosted integral routes.
 * Supports regular Routes and BoostedRoutes with automatic ERC4626 wrap/unwrap.
 */
export class OmegaTrade implements Command {
  readonly tradeType: RouterActionType = RouterActionType.OmegaTrade
  readonly trade: Trade<Currency, Currency, TradeType>
  readonly options: SwapOptions

  constructor(trade: Trade<Currency, Currency, TradeType>, options: SwapOptions) {
    this.trade = trade
    this.options = options
  }

  /**
   * Main encode — adds commands to planner.
   */
  public encode(planner: RoutePlanner) {
    const { route } = this.trade.swaps[0] as { route: BoostedRoute<Currency, Currency> | Route<Currency, Currency> }
    const exactInput = this.trade.tradeType === TradeType.EXACT_INPUT

    if (route.isBoosted) {
      this.encodeBoostedRoute(planner, route, exactInput)
    } else {
      this.encodeRegularRoute(planner, route, exactInput)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REGULAR ROUTE (non-boosted)
  // ═══════════════════════════════════════════════════════════════════════════

  private encodeRegularRoute(planner: RoutePlanner, route: Route<Currency, Currency>, exactInput: boolean) {
    const recipient = this.options.recipient
    const isInputNative = route.input.isNative
    const isOutputNative = route.output.isNative
    const path = encodeRouteToPath(route, !exactInput)

    if (exactInput) {
      const amountIn = this.trade.inputAmount.quotient.toString()
      const minAmountOut = this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()

      this.transferInputToken(planner, route.input.wrapped.address, amountIn.toString(), isInputNative)

      const swapRecipient = isOutputNative ? ADDRESS_THIS : recipient
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        swapRecipient,
        amountIn.toString(),
        minAmountOut.toString(),
        path,
        false,
      ])

      this.unwrapOutputIfNative(planner, recipient, isOutputNative)
    } else {
      const amountOut = this.trade.outputAmount.quotient.toString()
      const maxAmountIn = this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString()

      this.transferInputToken(planner, route.input.wrapped.address, maxAmountIn.toString(), isInputNative)

      const swapRecipient = isOutputNative ? ADDRESS_THIS : recipient
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        swapRecipient,
        amountOut.toString(),
        maxAmountIn.toString(),
        path,
        false,
      ])

      this.unwrapOutputIfNative(planner, recipient, isOutputNative)
      this.sweepUnusedInput(planner, route.input.wrapped.address, recipient, isInputNative)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOSTED ROUTE (with ERC4626 wrap/unwrap)
  // ═══════════════════════════════════════════════════════════════════════════

  private encodeBoostedRoute(planner: RoutePlanner, route: BoostedRoute<Currency, Currency>, exactInput: boolean) {
    const recipient = this.options.recipient

    if (exactInput) {
      this.encodeBoostedExactInput(planner, route, recipient)
    } else {
      this.encodeBoostedExactOutput(planner, route, recipient)
    }
  }

  /**
   * ExactInput: Process steps forward, each step output feeds into next step input
   */
  private encodeBoostedExactInput(planner: RoutePlanner, route: BoostedRoute<Currency, Currency>, recipient: string) {
    const { steps } = route
    const amount = this.trade.inputAmount.quotient.toString()
    const minAmountOut = this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()

    const isInputNative = route.input.isNative
    const isOutputNative = route.output.isNative

    // Transfer input token to router
    this.transferInputToken(planner, route.input.wrapped.address, amount, isInputNative)

    // Process each step
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const isFirstStep = i === 0
      const isLastStep = i === steps.length - 1

      const stepRecipient = isLastStep ? (isOutputNative ? ADDRESS_THIS : recipient) : ADDRESS_THIS
      const stepAmount = isFirstStep ? amount : CONTRACT_BALANCE
      const stepMinAmountOut = isLastStep ? minAmountOut : '0'

      this.encodeStep(planner, step, stepAmount, '0', stepMinAmountOut, stepRecipient, false)
    }

    // Unwrap output to native if needed
    this.unwrapOutputIfNative(planner, recipient, isOutputNative)
  }

  /**
   * ExactOutput for boosted routes (single SWAP only).
   * Requires stepAmountsOut from quoter for precise amounts at each step.
   */
  private encodeBoostedExactOutput(planner: RoutePlanner, route: BoostedRoute<Currency, Currency>, recipient: string) {
    const { steps } = route
    const { stepAmountsOut } = this.options

    // Validate: only one SWAP allowed for ExactOutput
    const swapCount = steps.filter((s) => s.type === BoostedRouteStepType.SWAP).length
    if (swapCount !== 1) {
      throw new Error(
        `ExactOutput boosted routes support exactly 1 SWAP, got ${swapCount}. Use ExactInput for multi-SWAP routes.`
      )
    }

    if (!stepAmountsOut || stepAmountsOut.length !== steps.length) {
      throw new Error(`ExactOutput boosted route requires stepAmountsOut array with ${steps.length} elements.`)
    }

    const maxAmountIn = this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString()
    const minAmountOut = this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()

    const isInputNative = route.input.isNative
    const isOutputNative = route.output.isNative

    this.transferInputToken(planner, route.input.wrapped.address, maxAmountIn, isInputNative)

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const isFirstStep = i === 0
      const isLastStep = i === steps.length - 1

      const stepRecipient = isLastStep ? (isOutputNative ? ADDRESS_THIS : recipient) : ADDRESS_THIS
      const stepAmountIn = isFirstStep ? maxAmountIn : CONTRACT_BALANCE
      const stepAmountOut = stepAmountsOut[i]
      const stepMinOut = isLastStep ? minAmountOut : '0'

      const isSwapStep = step.type === BoostedRouteStepType.SWAP
      this.encodeStep(planner, step, stepAmountIn, stepAmountOut, stepMinOut, stepRecipient, isSwapStep)
    }

    this.unwrapOutputIfNative(planner, recipient, isOutputNative)

    // Unwind intermediate tokens back to input token and sweep to user
    this.unwindIntermediateTokens(planner, steps, recipient)
    this.sweepUnusedInput(planner, route.input.wrapped.address, recipient, isInputNative)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP ENCODER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Encode a single step (WRAP, UNWRAP, or SWAP)
   * @param exactOutput - if true, SWAP uses ExactOutput command; WRAP/UNWRAP always use ExactInput
   */
  private encodeStep(
    planner: RoutePlanner,
    step: BoostedRouteStep,
    amountIn: string,
    amountOut: string,
    minAmountOut: string,
    recipient: string,
    exactOutput: boolean
  ) {
    switch (step.type) {
      case BoostedRouteStepType.WRAP:
        planner.addCommand(CommandType.ERC4626_WRAP, [
          step.tokenOut.address,
          step.tokenIn.address,
          recipient,
          amountIn,
          minAmountOut,
        ])
        break

      case BoostedRouteStepType.UNWRAP:
        planner.addCommand(CommandType.ERC4626_UNWRAP, [step.tokenIn.address, recipient, amountIn, minAmountOut])
        break

      case BoostedRouteStepType.SWAP: {
        const route = new Route([step.pool], step.tokenIn, step.tokenOut)
        if (exactOutput) {
          const path = encodeRouteToPath(route, exactOutput)
          planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [recipient, amountOut, amountIn, path, SOURCE_ROUTER])
        } else {
          const path = encodeRouteToPath(route, exactOutput)
          planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
            recipient,
            amountIn,
            minAmountOut,
            path,
            SOURCE_ROUTER,
          ])
        }
        break
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private transferInputToken(planner: RoutePlanner, tokenAddress: string, amount: string, isNative: boolean): void {
    if (isNative) {
      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount])
    } else {
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenAddress, ROUTER_ADDRESS, amount])
    }
  }

  private unwrapOutputIfNative(planner: RoutePlanner, recipient: string, isNative: boolean): void {
    if (isNative) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    }
  }

  private sweepUnusedInput(planner: RoutePlanner, tokenAddress: string, recipient: string, isNative: boolean): void {
    if (isNative) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [tokenAddress, recipient, 0])
    }
  }

  /**
   * Unwind intermediate tokens back to input token after ExactOutput.
   * For route A → B → C → D with remainders, unwinds C → B → A.
   * WRAP steps become UNWRAP, UNWRAP steps become WRAP (reversed).
   */
  private unwindIntermediateTokens(planner: RoutePlanner, steps: BoostedRouteStep[], _recipient: string): void {
    // Process steps in reverse, skipping the last step (output)
    for (let i = steps.length - 2; i >= 0; i--) {
      const step = steps[i]

      if (step.type === BoostedRouteStepType.WRAP) {
        planner.addCommand(CommandType.ERC4626_UNWRAP, [step.tokenOut.address, ADDRESS_THIS, CONTRACT_BALANCE, 0])
      } else if (step.type === BoostedRouteStepType.UNWRAP) {
        planner.addCommand(CommandType.ERC4626_WRAP, [
          step.tokenIn.address,
          step.tokenOut.address,
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          0,
        ])
      }
    }
  }
}
