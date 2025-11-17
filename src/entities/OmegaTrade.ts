import { BigNumber } from 'ethers'
import {
  Currency,
  TradeType,
  SwapOptions as RouterSwapOptions,
  Trade,
  Route,
  encodeRouteToPath,
  BoostedRoute,
  BoostedToken,
  encodeBoostedRouteToPath,
  AnyToken,
} from '@cryptoalgebra/integral-sdk'
import { CommandType, RoutePlanner } from '../utils/routerCommands'
import { Command, RouterActionType } from './Command'
import { Permit2Permit } from '../utils/inputTokens'
import { ROUTER_ADDRESS, MSG_SENDER, ADDRESS_THIS, CONTRACT_BALANCE, SOURCE_ROUTER } from '../constants'
import { BoostedSwapType, determineSwapType } from '../utils/swapTypeUtils'

// the existing router permit object doesn't include enough data for permit2
// so we extend swap options with the permit2 permit
export type SwapOptions = Omit<RouterSwapOptions, 'inputTokenPermit'> & {
  inputTokenPermit?: Permit2Permit
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
  public async encode(planner: RoutePlanner) {
    const { route } = this.trade.swaps[0] as { route: BoostedRoute<Currency, Currency> | Route<Currency, Currency> }
    const exactInput = this.trade.tradeType === TradeType.EXACT_INPUT

    if (route.isBoosted) {
      // Boosted route with wrap/unwrap logic
      await this.encodeBoostedRoute(planner, route, exactInput)
    } else {
      // Regular route
      this.encodeRegularRoute(planner, route, exactInput)
    }
  }

  /**
   * Encode for regular (non-boosted) route
   * Router contract handles multi-hop swaps automatically via encoded path
   */
  private encodeRegularRoute(planner: RoutePlanner, route: Route<Currency, Currency>, exactInput: boolean) {
    const recipient = this.options.recipient ?? MSG_SENDER
    const isInputNative = route.input.isNative
    const isOutputNative = route.output.isNative

    // Encode path for router
    const path = encodeRouteToPath(route, !exactInput)

    if (exactInput) {
      const amountIn = BigNumber.from(this.trade.inputAmount.quotient.toString())
      const minAmountOut = BigNumber.from(
        this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()
      )

      // 1. Transfer input token to router
      this.transferInputToken(planner, route.input.wrapped.address, amountIn.toString(), isInputNative)

      // 2. Execute swap (router handles all intermediate hops)
      const swapRecipient = isOutputNative ? ADDRESS_THIS : recipient
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        swapRecipient,
        amountIn.toString(),
        minAmountOut.toString(),
        path,
        false, // payerIsUser = false (already transferred)
      ])

      // 3. Unwrap WETH to native ETH if needed
      this.unwrapNativeIfNeeded(planner, recipient, isOutputNative)
    } else {
      const amountOut = BigNumber.from(this.trade.outputAmount.quotient.toString())
      const maxAmountIn = BigNumber.from(this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString())

      // 1. Transfer input token to router
      this.transferInputToken(planner, route.input.wrapped.address, maxAmountIn.toString(), isInputNative)

      // 2. Execute swap (router handles all intermediate hops)
      const swapRecipient = isOutputNative ? ADDRESS_THIS : recipient
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        swapRecipient,
        amountOut.toString(),
        maxAmountIn.toString(),
        path,
        false, // payerIsUser = false (already transferred)
      ])

      // 3. Unwrap WETH to native ETH if needed
      this.unwrapNativeIfNeeded(planner, recipient, isOutputNative)

      // 4. Sweep unused input tokens
      if (isInputNative) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      } else {
        planner.addCommand(CommandType.SWEEP, [route.input.wrapped.address, recipient, 0])
      }
    }
  }

  /**
   * Encode for boosted route with wrap/unwrap logic
   * Uses token properties to determine necessary operations
   */
  private async encodeBoostedRoute(
    planner: RoutePlanner,
    route: BoostedRoute<Currency, Currency>,
    exactInput: boolean
  ) {
    const recipient = this.options.recipient

    if (exactInput) {
      await this.encodeExactInput(planner, route, recipient)
    } else {
      await this.encodeExactOutput(planner, route, recipient)
    }
  }

  /**
   * Encode ExactInput flow - dynamic iteration through tokenPath
   * Analyzes each transition between tokens to determine operations
   */
  private async encodeExactInput(planner: RoutePlanner, route: BoostedRoute<Currency, Currency>, recipient: string) {
    const amount = BigNumber.from(this.trade.inputAmount.quotient.toString())
    const minAmountOut = this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()

    const isInputNative = route.input.isNative
    const isOutputNative = route.output.isNative
    const path = encodeBoostedRouteToPath(route, false)

    const { tokenPath } = route

    // Track if we need CONTRACT_BALANCE for swap (after wrap)
    let useContractBalanceForSwap = false

    // Iterate through tokenPath to determine operations
    for (let i = 0; i < tokenPath.length - 1; i++) {
      const currentToken = tokenPath[i]
      const nextToken = tokenPath[i + 1]

      const operationType = this.getOperationType(currentToken, nextToken)

      if (operationType === BoostedSwapType.WRAP_ONLY) {
        // Wrap operation: underlying → boosted
        if (i === 0) {
          // First operation - transfer input
          this.transferInputToken(planner, currentToken.address, amount.toString(), isInputNative)
        }

        const targetRecipient = i === tokenPath.length - 2 ? recipient : ADDRESS_THIS
        const wrapAmount = i === 0 ? amount.toString() : CONTRACT_BALANCE

        planner.addCommand(CommandType.ERC4626_WRAP, [
          nextToken.address,
          currentToken.address,
          targetRecipient,
          wrapAmount,
          0,
        ])

        useContractBalanceForSwap = true
      } else if (operationType === BoostedSwapType.UNWRAP_ONLY) {
        // Unwrap operation: boosted → underlying
        if (i === 0) {
          // First operation - transfer input
          planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
            currentToken.address,
            ROUTER_ADDRESS,
            amount.toString(),
          ])
        }

        const targetRecipient = i === tokenPath.length - 2 ? (isOutputNative ? ADDRESS_THIS : recipient) : ADDRESS_THIS
        const unwrapAmount = i === 0 ? amount.toString() : CONTRACT_BALANCE
        const minOut = i === tokenPath.length - 2 ? minAmountOut : '0'

        planner.addCommand(CommandType.ERC4626_UNWRAP, [currentToken.address, targetRecipient, unwrapAmount, minOut])

        if (i === tokenPath.length - 2 && isOutputNative) {
          this.unwrapNativeIfNeeded(planner, recipient, isOutputNative)
        }
      } else {
        // Swap operation through pool
        if (i === 0 && !currentToken.isBoosted) {
          // If starting with underlying token and no wrap before swap, transfer it
          this.transferInputToken(planner, currentToken.address, amount.toString(), isInputNative)
        } else if (i === 0 && currentToken.isBoosted) {
          // Starting with boosted token
          planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
            currentToken.address,
            ROUTER_ADDRESS,
            amount.toString(),
          ])
        }

        // Check if next operation is unwrap (need to calculate required boosted tokens)
        const nextIsUnwrap =
          i < tokenPath.length - 2 &&
          tokenPath[i + 2] &&
          nextToken.isBoosted &&
          !tokenPath[i + 2].isBoosted &&
          nextToken.underlying.equals(tokenPath[i + 2])

        let swapMinOut = minAmountOut
        if (nextIsUnwrap) {
          swapMinOut = (await (nextToken as BoostedToken).previewDeposit(BigInt(minAmountOut))).toString()
        }

        const swapRecipient = nextIsUnwrap ? ADDRESS_THIS : recipient
        const swapAmountIn = useContractBalanceForSwap ? CONTRACT_BALANCE : amount.toString()

        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          swapRecipient,
          swapAmountIn,
          swapMinOut,
          path,
          SOURCE_ROUTER,
        ])
      }
    }
  }

  /**
   * Encode ExactOutput flow - dynamic iteration through tokenPath
   * Analyzes each transition between tokens to determine operations
   */
  private async encodeExactOutput(planner: RoutePlanner, route: BoostedRoute<Currency, Currency>, recipient: string) {
    const amountOut = BigNumber.from(this.trade.outputAmount.quotient.toString())
    const maxAmountIn = this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString()

    const isInputNative = route.input.isNative
    const isOutputNative = route.output.isNative

    const path = encodeBoostedRouteToPath(route, true)
    const { tokenPath } = route

    // Track if we wrapped input (need CONTRACT_BALANCE for swap)
    let wrappedInput = false

    // For ExactOutput, we work backwards through the path to understand dependencies
    // First pass: identify operations
    const operations: Array<{
      type: BoostedSwapType
      fromIndex: number
      fromToken: AnyToken
      toToken: AnyToken
    }> = []

    for (let i = 0; i < tokenPath.length - 1; i++) {
      const currentToken = tokenPath[i]
      const nextToken = tokenPath[i + 1]

      const operationType = this.getOperationType(currentToken, nextToken)

      operations.push({
        type: operationType,
        fromIndex: i,
        fromToken: currentToken,
        toToken: nextToken,
      })
    }

    // Phase 1: Transfer input & optional wrap
    const firstOp = operations[0]
    if (firstOp.type === BoostedSwapType.WRAP_ONLY) {
      // Need to wrap input
      this.transferInputToken(planner, firstOp.fromToken.address, maxAmountIn, isInputNative)
      planner.addCommand(CommandType.ERC4626_WRAP, [
        firstOp.toToken.address,
        firstOp.fromToken.address,
        ADDRESS_THIS,
        maxAmountIn,
        0,
      ])
      wrappedInput = true
    } else if (firstOp.type === BoostedSwapType.UNWRAP_ONLY) {
      // Direct unwrap (no pool)
      if (operations.length === 1) {
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [firstOp.fromToken.address, ROUTER_ADDRESS, maxAmountIn])
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          firstOp.fromToken.address,
          isOutputNative ? ADDRESS_THIS : recipient,
          maxAmountIn,
          amountOut.toString(),
        ])
        this.unwrapNativeIfNeeded(planner, recipient, isOutputNative)
        return // Done
      }
    } else {
      // Starting with swap or boosted token
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [firstOp.fromToken.address, ROUTER_ADDRESS, maxAmountIn])
    }

    // Phase 2: Process swap if present
    const swapOp = operations.find(
      (op) => op.type !== BoostedSwapType.WRAP_ONLY && op.type !== BoostedSwapType.UNWRAP_ONLY
    )
    if (swapOp) {
      // Check if we need to unwrap after swap
      const swapIndex = operations.indexOf(swapOp)
      const nextOp = operations[swapIndex + 1]
      const needsUnwrap = nextOp && nextOp.type === BoostedSwapType.UNWRAP_ONLY

      let swapAmountOut = amountOut.toString()
      if (needsUnwrap) {
        // Calculate boosted tokens needed
        const boostedToken = swapOp.toToken as BoostedToken
        swapAmountOut = (await boostedToken.previewWithdraw(amountOut.toBigInt())).toString()
      }

      const swapRecipient = needsUnwrap ? ADDRESS_THIS : recipient
      const swapAmountInMax = wrappedInput ? CONTRACT_BALANCE : maxAmountIn

      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        swapRecipient,
        swapAmountOut,
        swapAmountInMax,
        path,
        SOURCE_ROUTER,
      ])

      // Phase 3: Unwrap output if needed
      if (needsUnwrap) {
        const boostedOut = swapOp.toToken as BoostedToken
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          boostedOut.address,
          isOutputNative ? ADDRESS_THIS : recipient,
          CONTRACT_BALANCE,
          amountOut.toString(),
        ])
        this.unwrapNativeIfNeeded(planner, recipient, isOutputNative)
      }
    } else if (operations.length === 1 && firstOp.type === BoostedSwapType.WRAP_ONLY) {
      // Direct wrap without swap
      // Already handled above, but recipient needs adjustment
      return
    }

    // Phase 4: Sweep unused input
    if (wrappedInput) {
      const boostedIn = operations[0].toToken as BoostedToken
      planner.addCommand(CommandType.ERC4626_UNWRAP, [
        boostedIn.address,
        isInputNative ? ADDRESS_THIS : recipient,
        CONTRACT_BALANCE,
        0,
      ])
      if (isInputNative) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      }
    }
  }

  /**
   * Helper: Transfer input tokens to router
   */
  private transferInputToken(planner: RoutePlanner, tokenAddress: string, amount: string, isNative: boolean): void {
    if (isNative) {
      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount])
    } else {
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenAddress, ROUTER_ADDRESS, amount])
    }
  }

  /**
   * Helper: Unwrap WETH to native ETH if needed
   */
  private unwrapNativeIfNeeded(planner: RoutePlanner, recipient: string, isNative: boolean): void {
    if (isNative) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    }
  }

  /**
   * Helper: Determine operation type between two adjacent tokens in path
   *
   * Uses determineSwapType to classify the transition between adjacent tokens.
   * For multi-hop routes, we need to analyze each step individually.
   *
   * @returns BoostedSwapType for this transition
   */
  private getOperationType(fromToken: AnyToken, toToken: AnyToken): BoostedSwapType {
    return determineSwapType(fromToken, toToken)
  }
}
