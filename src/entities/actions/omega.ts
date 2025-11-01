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
import { CONTRACT_BALANCE } from '../../utils/constants'
import { Command, RouterActionType } from '../Command'
import { Permit2Permit } from '../../utils/inputTokens'
import { BoostedSwapType, determineSwapType } from '../../utils/swapTypeUtils'
import { ROUTER_ADDRESS } from '../../constants'

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
 * OmegaTrade — универсальный класс для обычных и boosted-интегральных маршрутов.
 * Поддерживает обычные Routes и BoostedRoutes с автоматическим wrap/unwrap ERC4626.
 */
export class OmegaTrade implements Command {
  readonly tradeType: RouterActionType = RouterActionType.OmegaTrade
  readonly trade: Trade<Currency, Currency, TradeType>
  readonly options: SwapOptions
  readonly payerIsUser: boolean

  constructor(trade: Trade<Currency, Currency, TradeType>, options: SwapOptions) {
    this.trade = trade
    this.options = options

    // логика определения payer
    if (options.useRouterBalance) {
      this.payerIsUser = false
    } else {
      this.payerIsUser = true
    }
  }

  /**
   * Главный encode — добавляет команды в planner.
   */
  public encode(planner: RoutePlanner) {
    const { route } = this.trade.swaps[0] as { route: BoostedRoute<Currency, Currency> | Route<Currency, Currency> }
    const exactInput = this.trade.tradeType === TradeType.EXACT_INPUT

    // Определяем является ли route бустед роутом
    const isBoostedRoute = route instanceof BoostedRoute

    if (isBoostedRoute) {
      // Бустед роут с wrap/unwrap логикой
      this.encodeBoostedRoute(planner, route as BoostedRoute<Currency, Currency>, exactInput)
    } else {
      // Обычный роут без wrap/unwrap
      this.encodeRegularRoute(planner, route as Route<Currency, Currency>, exactInput)
    }
  }

  /**
   * Encode для обычного (не-бустед) роута
   */
  private encodeRegularRoute(planner: RoutePlanner, route: Route<Currency, Currency>, exactInput: boolean) {
    const amount = BigNumber.from(
      exactInput ? this.trade.inputAmount.quotient.toString() : this.trade.outputAmount.quotient.toString()
    )
    const recipient = this.options.recipient ?? MSG_SENDER

    // Используем encodeRouteToPath из SDK
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

      // Swap
      const swapRecipient = isOutputNative ? ADDRESS_THIS : recipient
      planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [swapRecipient, amount.toString(), 0, path, false])

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
   * Encode для бустед роута с wrap/unwrap логикой
   * Использует BoostedSwapType для определения необходимых операций
   */
  private encodeBoostedRoute(planner: RoutePlanner, route: BoostedRoute<Currency, Currency>, exactInput: boolean) {
    const tokenIn = route.input.wrapped
    const tokenOut = route.output.wrapped
    const swapType = determineSwapType(tokenIn, tokenOut)

    const recipient = this.options.recipient ?? MSG_SENDER
    const isInputNative = route.input.isNative

    console.log('🔍 encodeBoostedRoute:', {
      swapType,
      exactInput,
      isInputNative,
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
    })

    if (exactInput) {
      this.encodeExactInput(planner, route, swapType, isInputNative, recipient)
    } else {
      this.encodeExactOutput(planner, route, swapType, isInputNative, recipient)
    }
  }

  /**
   * Encode ExactInput flow
   */
  private encodeExactInput(
    planner: RoutePlanner,
    route: BoostedRoute<Currency, Currency>,
    swapType: BoostedSwapType,
    isInputNative: boolean,
    recipient: string
  ) {
    const amount = BigNumber.from(this.trade.inputAmount.quotient.toString())
    const tokenIn = route.input.wrapped
    const tokenOut = route.output.wrapped

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Transfer/Wrap input token
    // ═══════════════════════════════════════════════════════════
    if (isInputNative) {
      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount.toString()])
    } else {
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, amount.toString()])
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Handle swap based on type
    // ═══════════════════════════════════════════════════════════
    switch (swapType) {
      case BoostedSwapType.WRAP_ONLY: {
        // underlying → boosted (no pool)
        const boostedOut = tokenOut as BoostedToken
        planner.addCommand(CommandType.ERC4626_WRAP, [
          boostedOut.address,
          tokenIn.address,
          recipient,
          amount.toString(),
          0,
        ])
        break
      }

      case BoostedSwapType.UNWRAP_ONLY: {
        // boosted → underlying (no pool)
        const boostedIn = tokenIn as BoostedToken
        const finalRecipient = tokenOut.symbol === 'WETH' && isInputNative ? ADDRESS_THIS : recipient
        planner.addCommand(CommandType.ERC4626_UNWRAP, [boostedIn.address, finalRecipient, amount.toString(), 0])

        if (tokenOut.symbol === 'WETH' && isInputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }
        break
      }

      case BoostedSwapType.UNDERLYING_TO_UNDERLYING: {
        // wrap → swap → unwrap
        const boostedIn = route.tokenPath[1] as BoostedToken
        const boostedOut = route.tokenPath[route.tokenPath.length - 2] as BoostedToken

        // Wrap input
        planner.addCommand(CommandType.ERC4626_WRAP, [
          boostedIn.address,
          tokenIn.address,
          ADDRESS_THIS,
          amount.toString(),
          0,
        ])

        // Swap
        const path = encodeBoostedRouteToPath(route, false)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [ADDRESS_THIS, CONTRACT_BALANCE, 0, path, false])

        // Unwrap output
        const finalRecipient = tokenOut.symbol === 'WETH' ? ADDRESS_THIS : recipient
        planner.addCommand(CommandType.ERC4626_UNWRAP, [boostedOut.address, finalRecipient, CONTRACT_BALANCE, 0])

        if (tokenOut.symbol === 'WETH') {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }
        break
      }

      case BoostedSwapType.UNDERLYING_TO_BOOSTED: {
        // wrap → swap (no unwrap)
        const boostedIn = route.tokenPath[1] as BoostedToken

        // Wrap input
        planner.addCommand(CommandType.ERC4626_WRAP, [
          boostedIn.address,
          tokenIn.address,
          ADDRESS_THIS,
          amount.toString(),
          0,
        ])

        // Swap
        const path = encodeBoostedRouteToPath(route, false)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [recipient, CONTRACT_BALANCE, 0, path, false])
        break
      }

      case BoostedSwapType.BOOSTED_TO_UNDERLYING: {
        // swap → unwrap (no wrap)
        const boostedOut = route.tokenPath[route.tokenPath.length - 2] as BoostedToken

        // Swap
        const path = encodeBoostedRouteToPath(route, false)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [ADDRESS_THIS, amount.toString(), 0, path, false])

        // Unwrap output
        const finalRecipient = tokenOut.symbol === 'WETH' ? ADDRESS_THIS : recipient
        planner.addCommand(CommandType.ERC4626_UNWRAP, [boostedOut.address, finalRecipient, CONTRACT_BALANCE, 0])

        if (tokenOut.symbol === 'WETH') {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }
        break
      }

      case BoostedSwapType.BOOSTED_TO_BOOSTED: {
        // direct swap (no wrap/unwrap)
        const path = encodeBoostedRouteToPath(route, false)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_IN, [recipient, amount.toString(), 0, path, false])
        break
      }
    }
  }

  /**
   * Encode ExactOutput flow
   */
  private encodeExactOutput(
    planner: RoutePlanner,
    route: BoostedRoute<Currency, Currency>,
    swapType: BoostedSwapType,
    isInputNative: boolean,
    recipient: string
  ) {
    const amount = BigNumber.from(this.trade.outputAmount.quotient.toString())
    const maxAmountIn = BigNumber.from(this.trade.maximumAmountIn(this.options.slippageTolerance).quotient.toString())
    const tokenIn = route.input.wrapped
    const tokenOut = route.output.wrapped

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Transfer/Wrap max input token
    // ═══════════════════════════════════════════════════════════
    if (isInputNative) {
      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, maxAmountIn.toString()])
    } else {
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [tokenIn.address, ROUTER_ADDRESS, maxAmountIn.toString()])
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Handle swap based on type
    // ═══════════════════════════════════════════════════════════
    switch (swapType) {
      case BoostedSwapType.WRAP_ONLY: {
        // underlying → boosted (no pool)
        const boostedOut = tokenOut as BoostedToken
        planner.addCommand(CommandType.ERC4626_WRAP, [
          boostedOut.address,
          tokenIn.address,
          recipient,
          amount.toString(),
          0,
        ])

        // Sweep unused input
        if (isInputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        } else {
          planner.addCommand(CommandType.SWEEP, [tokenIn.address, recipient, 0])
        }
        break
      }

      case BoostedSwapType.UNWRAP_ONLY: {
        // boosted → underlying (no pool)
        const boostedIn = tokenIn as BoostedToken
        const finalRecipient = tokenOut.symbol === 'WETH' && isInputNative ? ADDRESS_THIS : recipient
        planner.addCommand(CommandType.ERC4626_UNWRAP, [boostedIn.address, finalRecipient, amount.toString(), 0])

        if (tokenOut.symbol === 'WETH' && isInputNative) {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }

        // Sweep unused input vault tokens
        planner.addCommand(CommandType.SWEEP, [boostedIn.address, recipient, 0])
        break
      }

      case BoostedSwapType.UNDERLYING_TO_UNDERLYING: {
        // wrap → swap → unwrap
        const boostedIn = route.tokenPath[1] as BoostedToken
        const boostedOut = route.tokenPath[route.tokenPath.length - 2] as BoostedToken

        // Wrap max input
        planner.addCommand(CommandType.ERC4626_WRAP, [
          boostedIn.address,
          tokenIn.address,
          ADDRESS_THIS,
          maxAmountIn.toString(),
          0,
        ])

        // Swap
        const path = encodeBoostedRouteToPath(route, true)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          ADDRESS_THIS,
          amount.toString(),
          CONTRACT_BALANCE,
          path,
          false,
        ])

        // Unwrap output
        const finalRecipient = tokenOut.symbol === 'WETH' ? ADDRESS_THIS : recipient
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          boostedOut.address,
          finalRecipient,
          CONTRACT_BALANCE,
          amount.toString(),
        ])

        if (tokenOut.symbol === 'WETH') {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }

        // Unwrap unused input vault tokens
        planner.addCommand(CommandType.ERC4626_UNWRAP, [boostedIn.address, ADDRESS_THIS, CONTRACT_BALANCE, 0])

        // Sweep unused underlying input
        if (isInputNative || tokenIn.symbol === 'WETH') {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        } else {
          planner.addCommand(CommandType.SWEEP, [tokenIn.address, recipient, 0])
        }
        break
      }

      case BoostedSwapType.UNDERLYING_TO_BOOSTED: {
        // wrap → swap (no unwrap)
        const boostedIn = route.tokenPath[1] as BoostedToken

        // Wrap max input
        planner.addCommand(CommandType.ERC4626_WRAP, [
          boostedIn.address,
          tokenIn.address,
          ADDRESS_THIS,
          maxAmountIn.toString(),
          0,
        ])

        // Swap
        const path = encodeBoostedRouteToPath(route, true)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          recipient,
          amount.toString(),
          CONTRACT_BALANCE,
          path,
          false,
        ])

        // Unwrap unused input vault tokens
        planner.addCommand(CommandType.ERC4626_UNWRAP, [boostedIn.address, ADDRESS_THIS, CONTRACT_BALANCE, 0])

        // Sweep unused underlying input
        if (isInputNative || tokenIn.symbol === 'WETH') {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        } else {
          planner.addCommand(CommandType.SWEEP, [tokenIn.address, recipient, 0])
        }
        break
      }

      case BoostedSwapType.BOOSTED_TO_UNDERLYING: {
        // swap → unwrap (no wrap)
        const boostedOut = route.tokenPath[route.tokenPath.length - 2] as BoostedToken

        // Swap
        const path = encodeBoostedRouteToPath(route, true)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          ADDRESS_THIS,
          amount.toString(),
          maxAmountIn.toString(),
          path,
          false,
        ])

        // Unwrap output
        const finalRecipient = tokenOut.symbol === 'WETH' ? ADDRESS_THIS : recipient
        planner.addCommand(CommandType.ERC4626_UNWRAP, [
          boostedOut.address,
          finalRecipient,
          CONTRACT_BALANCE,
          amount.toString(),
        ])

        if (tokenOut.symbol === 'WETH') {
          planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
        }

        // Sweep unused input vault tokens
        planner.addCommand(CommandType.SWEEP, [tokenIn.address, recipient, 0])
        break
      }

      case BoostedSwapType.BOOSTED_TO_BOOSTED: {
        // direct swap (no wrap/unwrap)
        const path = encodeBoostedRouteToPath(route, true)
        planner.addCommand(CommandType.INTEGRAL_SWAP_EXACT_OUT, [
          recipient,
          amount.toString(),
          maxAmountIn.toString(),
          path,
          false,
        ])

        // Sweep unused input vault tokens
        planner.addCommand(CommandType.SWEEP, [tokenIn.address, recipient, 0])
        break
      }
    }
  }
}
