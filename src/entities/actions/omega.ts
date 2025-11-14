import { BigNumber, BigNumberish } from 'ethers'
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
} from '@cryptoalgebra/integral-sdk'
import { CommandType, RoutePlanner } from '../../utils/routerCommands'
import { Command, RouterActionType } from '../Command'
import { Permit2Permit } from '../../utils/inputTokens'
import { BoostedSwapType, determineSwapType } from '../../utils/swapTypeUtils'
import { ROUTER_ADDRESS, MSG_SENDER, ADDRESS_THIS, CONTRACT_BALANCE, SOURCE_ROUTER } from '../../constants'

export type FlatFeeOptions = {
  amount: BigNumberish
  recipient: string
}

// the existing router permit object doesn't include enough data for permit2
// so we extend swap options with the permit2 permit
// when safe mode is enabled, the SDK will add an extra ETH sweep for security
// when useRouterBalance is enabled the SDK will use the balance in the router for the swap
export type SwapOptions = Omit<RouterSwapOptions, 'inputTokenPermit'> & {
  useRouterBalance?: boolean
  inputTokenPermit?: Permit2Permit
  flatFee?: FlatFeeOptions
  safeMode?: boolean
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

    // Determine if route is a boosted route
    const isBoosted = route.isBoosted

    if (isBoosted) {
      // Boosted route with wrap/unwrap logic
      await this.encodeBoostedRoute(planner, route as BoostedRoute<Currency, Currency>, exactInput)
    } else {
      // Regular route
      this.encodeRegularRoute(planner, route as Route<Currency, Currency>, exactInput)
    }
  }

  /**
   * Encode for regular (non-boosted) route
   */
  private encodeRegularRoute(planner: RoutePlanner, route: Route<Currency, Currency>, exactInput: boolean) {
    const amount = BigNumber.from(
      exactInput ? this.trade.inputAmount.quotient.toString() : this.trade.outputAmount.quotient.toString()
    )
    const recipient = this.options.recipient ?? MSG_SENDER

    const path = encodeRouteToPath(route, !exactInput)

    // Transfer input token
    const inputToken = route.input.wrapped
    const isInputNative = route.input.isNative
    const isOutputNative = route.output.isNative

    if (exactInput) {
      // Handle input transfer
      if (isInputNative) {
        planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount.toString()])
      } else {
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [inputToken.address, ROUTER_ADDRESS, amount.toString()])
      }

      // Swap with slippage protection from trade
      const minAmountOut = BigNumber.from(
        this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()
      )

      // Router handles intermediate tokens automatically in multi-hop swaps
      const swapRecipient = isOutputNative ? ADDRESS_THIS : recipient

      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
        swapRecipient,
        amount.toString(),
        minAmountOut.toString(),
        path,
        false,
      ])

      // Handle output unwrap if native
      if (isOutputNative) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      }
    } else {
      const maxAmountIn = BigNumber.from(this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString())

      // Handle input transfer
      if (isInputNative) {
        planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, maxAmountIn.toString()])
      } else {
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
          inputToken.address,
          ROUTER_ADDRESS,
          maxAmountIn.toString(),
        ])
      }

      // Swap
      const swapRecipient = isOutputNative ? ADDRESS_THIS : recipient
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
        swapRecipient,
        amount.toString(),
        maxAmountIn.toString(),
        path,
        false,
      ])

      // Handle output unwrap if native
      if (isOutputNative) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      }

      // Sweep unused input
      if (isInputNative) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      } else {
        planner.addCommand(CommandType.SWEEP, [inputToken.address, recipient, 0])
      }
    }
  }

  /**
   * Encode for boosted route with wrap/unwrap logic
   * Uses BoostedSwapType to determine necessary operations
   */
  private async encodeBoostedRoute(
    planner: RoutePlanner,
    route: BoostedRoute<Currency, Currency>,
    exactInput: boolean
  ) {
    const tokenIn = route.input.wrapped
    const tokenOut = route.output.wrapped

    const recipient = this.options.recipient

    const swapType = determineSwapType(tokenIn, tokenOut)

    if (exactInput) {
      await this.encodeExactInput(planner, route, swapType, recipient)
    } else {
      await this.encodeExactOutput(planner, route, swapType, recipient)
    }
  }

  /**
   * Encode ExactInput flow
   */
  private async encodeExactInput(
    planner: RoutePlanner,
    route: BoostedRoute<Currency, Currency>,
    swapType: BoostedSwapType,
    recipient: string
  ) {
    const tokenIn = route.input.wrapped
    const tokenOut = route.output.wrapped

    const amount = BigNumber.from(this.trade.inputAmount.quotient.toString())
    const minAmountOut = this.trade.minimumAmountOut(this.options.slippageTolerance).quotient.toString()

    const isInputNative = route.input.isNative
    const isOutputNative = route.output.isNative

    const path = encodeBoostedRouteToPath(route, false)

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Handle Swap or ERC4626 Wrap based on type
    // ═══════════════════════════════════════════════════════════
    switch (swapType) {
      case BoostedSwapType.WRAP_ONLY: {
        if (isInputNative) {
          planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount.toString()])
        } else {
          planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, amount.toString()])
        }

        // underlying → boosted (no pool)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          tokenOut.address, // vault
          tokenIn.address, // asset
          recipient, // recipient
          amount.toString(), // amount
          0, // minSharesOut
        ])
        break
      }

      case BoostedSwapType.UNWRAP_ONLY: {
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, amount.toString()])

        // boosted → underlying (no pool)
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          tokenIn.address, // vault
          isOutputNative ? ADDRESS_THIS : recipient, // recipient
          amount.toString(), // shares
          minAmountOut, // amountMin
        ])

        // Unwrap WETH
        if (isOutputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }
        break
      }

      case BoostedSwapType.UNDERLYING_TO_UNDERLYING: {
        // Transfer input token to router

        if (isInputNative) {
          planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount.toString()])
        } else {
          planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, amount.toString()])
        }

        // wrap → swap → unwrap
        const boostedIn = route.tokenPath[1]
        const boostedOut = route.tokenPath[route.tokenPath.length - 2] as BoostedToken

        const boostedMinAmountOut = await boostedOut.previewDeposit(BigInt(minAmountOut))

        // ERC4626 Wrap input
        planner.addCommand(CommandType.ERC4626_WRAP, [
          boostedIn.address, // vault
          tokenIn.address, // asset
          ADDRESS_THIS, // recipient
          amount.toString(), // amount
          0, // minSharesOut
        ])

        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          boostedMinAmountOut,
          path,
          SOURCE_ROUTER,
        ])

        // ERC4626 Unwrap
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          boostedOut.address,
          isOutputNative ? ADDRESS_THIS : recipient,
          CONTRACT_BALANCE,
          0,
        ])

        // Unwrap WETH
        if (isOutputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }
        break
      }

      case BoostedSwapType.UNDERLYING_TO_BOOSTED: {
        // wrap → swap (no unwrap)
        const boostedIn = route.tokenPath[1] as BoostedToken

        // Transfer input token to router
        if (isInputNative) {
          planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount.toString()])
        } else {
          planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, amount.toString()])
        }

        // Wrap input
        planner.addCommand(CommandType.ERC4626_WRAP, [
          boostedIn.address, // vault
          tokenIn.address, // asset
          ADDRESS_THIS, // recipient
          amount.toString(), // amount
          0, // minSharesOut
        ])

        // Swap
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          recipient, // recipient
          CONTRACT_BALANCE, // amount
          minAmountOut, // minAmountOut
          path, // path
          SOURCE_ROUTER, // source router
        ])
        break
      }

      case BoostedSwapType.BOOSTED_TO_UNDERLYING: {
        // swap → unwrap (no wrap)
        const boostedOut = route.tokenPath[route.tokenPath.length - 2] as BoostedToken

        const boostedMinAmountOut = await boostedOut.previewDeposit(BigInt(minAmountOut))

        // Transfer input token to router
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, amount.toString()])

        // Swap
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          boostedMinAmountOut.toString(),
          path,
          SOURCE_ROUTER,
        ])

        // ERC4626 Unwrap
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          boostedOut.address, // vault
          isOutputNative ? ADDRESS_THIS : recipient, // recipient
          CONTRACT_BALANCE, // shares
          0, // amountMin
        ])

        if (isOutputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }
        break
      }

      case BoostedSwapType.BOOSTED_TO_BOOSTED: {
        // Transfer input token to router
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, amount.toString()])

        // Direct swap (no wrap/unwrap)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [
          recipient,
          amount.toString(),
          minAmountOut, // minAmountOut
          path,
          SOURCE_ROUTER,
        ])
        break
      }
    }
  }

  /**
   * Encode ExactOutput flow
   */
  private async encodeExactOutput(
    planner: RoutePlanner,
    route: BoostedRoute<Currency, Currency>,
    swapType: BoostedSwapType,
    recipient: string
  ) {
    const tokenIn = route.input.wrapped
    const tokenOut = route.output.wrapped

    const amountIn = BigNumber.from(this.trade.inputAmount.quotient.toString())
    const amountOut = BigNumber.from(this.trade.outputAmount.quotient.toString())
    const maxAmountIn = this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString()

    const isInputNative = route.input.isNative
    const isOutputNative = route.output.isNative

    const path = encodeBoostedRouteToPath(route, true)

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Handle swap based on type
    // ═══════════════════════════════════════════════════════════
    switch (swapType) {
      case BoostedSwapType.WRAP_ONLY: {
        if (isInputNative) {
          planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amountIn.toString()])
        } else {
          planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, amountIn.toString()])
        }

        // underlying → boosted (no pool)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          tokenOut.address, // vault
          tokenIn.address, // asset
          recipient, // recipient
          amountIn.toString(), // amount
          0, // minSharesOut
        ])
        break
      }

      case BoostedSwapType.UNWRAP_ONLY: {
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, amountIn.toString()])

        // boosted → underlying (no pool)
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          tokenIn.address, // vault
          isOutputNative ? ADDRESS_THIS : recipient, // recipient
          amountIn.toString(), // shares
          0, // amountMin
        ])

        // Unwrap WETH
        if (isOutputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }
        break
      }

      case BoostedSwapType.UNDERLYING_TO_UNDERLYING: {
        // wrap → swap → unwrap
        const boostedIn = route.tokenPath[1]
        const boostedOut = route.tokenPath[route.tokenPath.length - 2] as BoostedToken

        if (isInputNative) {
          planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, maxAmountIn.toString()])
        } else {
          planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
            tokenIn.address,
            ROUTER_ADDRESS,
            maxAmountIn.toString(),
          ])
        }

        // Wrap max input
        planner.addCommand(CommandType.ERC4626_WRAP, [
          boostedIn.address,
          tokenIn.address,
          ADDRESS_THIS,
          maxAmountIn.toString(),
          0,
        ])

        // For ExactOutput: calculate how many vault tokens needed to withdraw desired underlying amount
        // Using previewWithdraw(assets) -> shares (ERC4626 standard method)
        // This returns the exact number of shares needed to withdraw the specified amount of assets
        const boostedAmountOut = await boostedOut.previewWithdraw(amountOut.toBigInt())

        // Swap to get exact amount of boosted output tokens
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          ADDRESS_THIS, // recipient
          boostedAmountOut.toString(), // exact boosted token amount needed
          CONTRACT_BALANCE, // amountInMax
          path,
          SOURCE_ROUTER,
        ])

        // Unwrap all received boosted tokens to underlying
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          boostedOut.address,
          isOutputNative ? ADDRESS_THIS : recipient,
          CONTRACT_BALANCE, // Unwrap all boosted tokens received from swap
          amountOut.toString(), // Minimum underlying tokens expected
        ])

        // Unwrap WETH if needed
        if (isOutputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }

        // Unwrap leftover input boosted tokens and return to user
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          boostedIn.address,
          isInputNative ? ADDRESS_THIS : recipient,
          CONTRACT_BALANCE,
          0,
        ])

        if (isInputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }

        break
      }

      case BoostedSwapType.UNDERLYING_TO_BOOSTED: {
        // wrap → swap (no unwrap)
        const boostedIn = route.tokenPath[1] as BoostedToken

        if (isInputNative) {
          planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, maxAmountIn.toString()])
        } else {
          planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
            tokenIn.address,
            ROUTER_ADDRESS,
            maxAmountIn.toString(),
          ])
        }

        // Wrap max input
        planner.addCommand(CommandType.ERC4626_WRAP, [boostedIn.address, tokenIn.address, ADDRESS_THIS, maxAmountIn, 0])

        // Swap
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          recipient,
          amountOut.toString(),
          CONTRACT_BALANCE,
          path,
          SOURCE_ROUTER,
        ])

        // Unwrap leftover input boosted tokens and return to user
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          boostedIn.address,
          isInputNative ? ADDRESS_THIS : recipient,
          CONTRACT_BALANCE,
          0,
        ])

        if (isInputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }
        break
      }

      case BoostedSwapType.BOOSTED_TO_UNDERLYING: {
        // swap → unwrap (no wrap)
        const boostedOut = route.tokenPath[route.tokenPath.length - 2] as BoostedToken

        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, maxAmountIn.toString()])

        // Calculate how many boosted tokens needed to withdraw desired underlying amount
        // Using previewWithdraw(assets) -> shares (ERC4626 standard method)
        const boostedAmountOut = await boostedOut.previewWithdraw(amountOut.toBigInt())

        // Swap to get exact amount of boosted tokens
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          ADDRESS_THIS,
          boostedAmountOut.toString(),
          CONTRACT_BALANCE,
          path,
          SOURCE_ROUTER,
        ])

        // Unwrap all received boosted tokens to underlying
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          boostedOut.address,
          isOutputNative ? ADDRESS_THIS : recipient,
          CONTRACT_BALANCE, // Unwrap all boosted tokens received from swap
          amountOut.toString(), // Minimum underlying tokens expected
        ])

        // Unwrap WETH if needed
        if (isOutputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }

        // Sweep leftover input boosted tokens ?
        break
      }

      case BoostedSwapType.BOOSTED_TO_BOOSTED: {
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, maxAmountIn.toString()])

        // direct swap (no wrap/unwrap)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          recipient,
          amountOut.toString(),
          CONTRACT_BALANCE,
          path,
          false,
        ])

        break
      }
    }
  }
}
