import invariant from 'tiny-invariant'
import {
  Currency,
  MethodParameters,
  Trade,
  TradeType,
  Position,
  Percent,
  CurrencyAmount,
  unwrappedToken,
  MaxUint128,
  AnyToken,
} from '@cryptoalgebra/integral-sdk'
import { Interface } from '@ethersproject/abi'
import { BigNumber, BigNumberish } from 'ethers'
import { CommandType, RoutePlanner } from './utils/routerCommands'
import { encodePermit, Permit2Permit } from './utils/inputTokens'
import { Address } from 'viem'
import { omegaRouterAbi } from './abis'
import { ADDRESS_THIS, CONTRACT_BALANCE, ROUTER_ADDRESS } from './constants'
import { encodeERC721Permit, encodeDecreaseLiquidity, encodeCollect, encodeBurn } from './utils/encodeCall'
import { OmegaTrade, SwapOptions } from './entities'

export type OmegaRouterConfig = {
  sender?: string // address
  deadline?: BigNumberish
}

export interface OmegaMintOptions {
  recipient: Address // Required for both mint and increase (for refunds)
  createPool?: boolean
  slippageTolerance: Percent
  deadline: BigNumberish
  useNative?: boolean
  deployer?: Address
  token0Permit?: Permit2Permit
  token1Permit?: Permit2Permit
  // Underlying amounts to wrap. If provided, will wrap underlying → boosted before mint
  amount0Underlying?: CurrencyAmount<Currency>
  amount1Underlying?: CurrencyAmount<Currency>
  // If tokenId is provided, will increase liquidity instead of minting new position
  tokenId?: BigNumberish
}

export interface OmegaRemoveLiquidityOptions {
  tokenId: BigNumberish
  liquidityPercentage: Percent
  slippageTolerance: Percent
  deadline: BigNumberish
  burnToken?: boolean
  permit: {
    v: number
    r: string
    s: string
    deadline: number
  }
  recipient: Address // Where to send the removed liquidity
  token0Unwrap?: boolean // unwrap token0 boosted → underlying
  token1Unwrap?: boolean // unwrap token1 boosted → underlying
}

export interface OmegaCollectOptions {
  tokenId: BigNumberish
  recipient: Address
  permit?: {
    v: number
    r: string
    s: string
    deadline: number
  }
  token0Unwrap?: boolean // unwrap token0 boosted → underlying
  token1Unwrap?: boolean // unwrap token1 boosted → underlying
}

export abstract class OmegaRouter {
  public static INTERFACE: Interface = new Interface(omegaRouterAbi)

  public static async swapCallParameters(
    trade: Trade<Currency, Currency, TradeType>,
    options: SwapOptions
  ): Promise<MethodParameters> {
    const planner = new RoutePlanner()

    const omegaTrade: OmegaTrade = new OmegaTrade(trade, options)

    const inputCurrency = omegaTrade.trade.inputAmount.currency
    invariant(!(inputCurrency.isNative && !!options.inputTokenPermit), 'NATIVE_INPUT_PERMIT')

    if (options.inputTokenPermit) {
      encodePermit(planner, options.inputTokenPermit)
    }

    const nativeCurrencyValue = inputCurrency.isNative
      ? BigNumber.from(omegaTrade.trade.maximumAmountIn(options.slippageTolerance).quotient.toString())
      : BigNumber.from(0)

    await omegaTrade.encode(planner)
    return OmegaRouter.encodePlan(planner, nativeCurrencyValue, {
      deadline: options.deadline ? BigNumber.from(options.deadline) : undefined,
    })
  }

  /**
   * Produces the on-chain method name and parameters to mint a new position or increase liquidity
   * Supports boosted pools with automatic wrap/unwrap of ERC4626 tokens
   * @param position The position to mint or increase
   * @param options Options for the transaction
   */
  public static addCallParameters(position: Position, options: OmegaMintOptions): MethodParameters {
    const planner = new RoutePlanner()

    const {
      recipient,
      slippageTolerance,
      deadline,
      useNative,
      deployer,
      token0Permit,
      token1Permit,
      amount0Underlying,
      amount1Underlying,
      tokenId,
    } = options

    const isIncrease = tokenId !== undefined

    // ═══════════════════════════════════════════════════════════
    // Extract amounts from position and determine wrapping strategy
    // ═══════════════════════════════════════════════════════════
    const { amount0: positionAmount0JSBI, amount1: positionAmount1JSBI } = position.mintAmounts
    const token0 = unwrappedToken(position.pool.token0)
    const token1 = unwrappedToken(position.pool.token1)

    // If underlying amounts provided, we need to wrap; otherwise use position amounts
    const token0NeedsWrap = Boolean(amount0Underlying)
    const token1NeedsWrap = Boolean(amount1Underlying)

    // Create CurrencyAmount from position JSBI amounts for consistency
    const positionAmount0 = CurrencyAmount.fromRawAmount(position.pool.token0, positionAmount0JSBI.toString())
    const positionAmount1 = CurrencyAmount.fromRawAmount(position.pool.token1, positionAmount1JSBI.toString())

    const amount0ToTransfer = token0NeedsWrap ? amount0Underlying! : positionAmount0
    const amount1ToTransfer = token1NeedsWrap ? amount1Underlying! : positionAmount1

    const isToken0Native = useNative && unwrappedToken(amount0ToTransfer.currency).isNative
    const isToken1Native = useNative && unwrappedToken(amount1ToTransfer.currency).isNative

    let nativeValue = BigNumber.from(0)

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Permit2 signatures (if needed)
    // ═══════════════════════════════════════════════════════════
    const amount0Str = amount0ToTransfer.quotient.toString()
    const amount1Str = amount1ToTransfer.quotient.toString()

    if (token0Permit && !isToken0Native && amount0Str !== '0') {
      encodePermit(planner, token0Permit)
    }
    if (token1Permit && !isToken1Native && amount1Str !== '0') {
      encodePermit(planner, token1Permit)
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Transfer underlying tokens to router
    // ═══════════════════════════════════════════════════════════
    if (amount0Str !== '0') {
      if (isToken0Native) {
        nativeValue = nativeValue.add(amount0Str)
        planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount0Str])
      } else {
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
          amount0ToTransfer.currency.wrapped.address,
          ROUTER_ADDRESS,
          amount0Str,
        ])
      }
    }
    if (amount1Str !== '0') {
      if (isToken1Native) {
        nativeValue = nativeValue.add(amount1Str)
        planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount1Str])
      } else {
        planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
          amount1ToTransfer.currency.wrapped.address,
          ROUTER_ADDRESS,
          amount1Str,
        ])
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Wrap underlying → boosted (if needed)
    // ═══════════════════════════════════════════════════════════
    if (token0NeedsWrap && token0.isBoosted && amount0Str !== '0') {
      planner.addCommand(CommandType.ERC4626_WRAP, [
        token0.wrapped.address,
        token0.underlying.address,
        ADDRESS_THIS,
        amount0Str,
        0,
      ])
    }

    if (token1NeedsWrap && token1.isBoosted && amount1Str !== '0') {
      planner.addCommand(CommandType.ERC4626_WRAP, [
        token1.wrapped.address,
        token1.underlying.address,
        ADDRESS_THIS,
        amount1Str,
        0,
      ])
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Calculate amounts for mint/increase
    // ═══════════════════════════════════════════════════════════
    // When wrapping: use CONTRACT_BALANCE to consume all wrapped tokens
    // Otherwise: use specific position amounts
    const mintAmount0Desired =
      token0NeedsWrap && token0.isBoosted ? CONTRACT_BALANCE : BigNumber.from(positionAmount0.quotient.toString())
    const mintAmount1Desired =
      token1NeedsWrap && token1.isBoosted ? CONTRACT_BALANCE : BigNumber.from(positionAmount1.quotient.toString())

    // Calculate minimum amounts with slippage tolerance
    const { amount0: amount0MinJSBI, amount1: amount1MinJSBI } = position.mintAmountsWithSlippage(slippageTolerance)
    let amount0Min = BigNumber.from(amount0MinJSBI.toString())
    let amount1Min = BigNumber.from(amount1MinJSBI.toString())

    // CRITICAL: Apply rounding buffer when wrapping to account for ERC4626 previewDeposit rounding
    if (token0NeedsWrap && token0.isBoosted && amount0Min.gt(0)) {
      const buffer = amount0Min.div(10000) // 0.01% buffer
      amount0Min = amount0Min.sub(buffer.gt(0) ? buffer : 1)
    }

    if (token1NeedsWrap && token1.isBoosted && amount1Min.gt(0)) {
      const buffer = amount1Min.div(10000) // 0.01% buffer
      amount1Min = amount1Min.sub(buffer.gt(0) ? buffer : 1)
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 5: Mint or Increase Liquidity
    // ═══════════════════════════════════════════════════════════

    if (isIncrease) {
      planner.addCommand(CommandType.INTEGRAL_INCREASE_LIQUIDITY, [
        [
          tokenId!.toString(),
          mintAmount0Desired.toString(),
          mintAmount1Desired.toString(),
          amount0Min.toString(),
          amount1Min.toString(),
          deadline.toString(),
        ],
      ])
    } else {
      planner.addCommand(CommandType.INTEGRAL_MINT, [
        [
          token0.wrapped.address,
          token1.wrapped.address,
          deployer || '0x0000000000000000000000000000000000000000',
          position.tickLower,
          position.tickUpper,
          mintAmount0Desired.toString(),
          mintAmount1Desired.toString(),
          amount0Min.toString(),
          amount1Min.toString(),
          recipient,
          deadline.toString(),
        ],
      ])
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 6: Refund unused tokens
    // ═══════════════════════════════════════════════════════════
    // Token0 refund logic
    if (token0NeedsWrap && token0.isBoosted) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [
        token0.wrapped.address,
        isToken0Native ? ADDRESS_THIS : recipient,
        CONTRACT_BALANCE,
        0,
      ])
      if (isToken0Native) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      }
    } else if (isToken0Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token0.wrapped.address, recipient, 0])
    }

    // Token1 refund logic
    if (token1NeedsWrap && token1.isBoosted) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [
        token1.wrapped.address,
        isToken1Native ? ADDRESS_THIS : recipient,
        CONTRACT_BALANCE,
        0,
      ])
      if (isToken1Native) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      }
    } else if (isToken1Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token1.wrapped.address, recipient, 0])
    }

    return OmegaRouter.encodePlan(planner, nativeValue, { deadline })
  }

  /**
   * Produces the on-chain method name and parameters to remove liquidity from a position
   * Supports boosted pools with automatic unwrap of ERC4626 tokens
   * @param position The position to remove liquidity from
   * @param options Options for the transaction
   */
  public static removeCallParameters(position: Position, options: OmegaRemoveLiquidityOptions): MethodParameters {
    const planner = new RoutePlanner()

    const {
      tokenId,
      liquidityPercentage,
      slippageTolerance,
      deadline,
      burnToken,
      permit,
      recipient,
      token0Unwrap,
      token1Unwrap,
    } = options

    const token0 = position.pool.token0
    const token1 = position.pool.token1
    const isBoostedToken0 = token0.isBoosted
    const isBoostedToken1 = token1.isBoosted

    const isToken0Native = unwrappedToken(token0Unwrap && token0.isBoosted ? token0.underlying : token0).isNative
    const isToken1Native = unwrappedToken(token1Unwrap && token1.isBoosted ? token1.underlying : token1).isNative

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Calculate liquidity to remove
    // ═══════════════════════════════════════════════════════════
    const partialPosition = new Position({
      pool: position.pool,
      liquidity: liquidityPercentage.multiply(position.liquidity).quotient,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
    })

    const { amount0: amount0Min, amount1: amount1Min } = partialPosition.burnAmountsWithSlippage(slippageTolerance)

    // ═══════════════════════════════════════════════════════════
    // STEP 2: ERC721 Permit (if provided)
    // ═══════════════════════════════════════════════════════════
    if (permit) {
      const encodedPermit = encodeERC721Permit({
        spender: ROUTER_ADDRESS,
        tokenId: BigNumber.from(tokenId),
        deadline: permit.deadline.toString(),
        v: permit.v,
        r: permit.r,
        s: permit.s,
      })
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_PERMIT, [encodedPermit])
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Decrease Liquidity
    // ═══════════════════════════════════════════════════════════
    // Ensure liquidity fits in uint128 by masking to 128 bits
    const liquidityBN = BigNumber.from(partialPosition.liquidity.toString())
    const encodedDecreaseCall = encodeDecreaseLiquidity({
      tokenId: BigNumber.from(tokenId),
      liquidity: liquidityBN,
      amount0Min: Number(amount0Min.toString()),
      amount1Min: Number(amount1Min.toString()),
      deadline: deadline.toString(),
    })
    planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [encodedDecreaseCall])

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Collect tokens to router
    // ═══════════════════════════════════════════════════════════
    // IMPORTANT: recipient must be ROUTER_ADDRESS for tokens to be available for unwrap/sweep
    const encodedCollectCall = encodeCollect({
      tokenId: BigNumber.from(tokenId),
      recipient: ROUTER_ADDRESS,
      amount0Max: MaxUint128,
      amount1Max: MaxUint128,
    })
    planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [encodedCollectCall])

    // ═══════════════════════════════════════════════════════════
    // STEP 5: Unwrap or Sweep tokens to recipient
    // ═══════════════════════════════════════════════════════════
    // Token0: If boosted AND unwrap requested → unwrap to underlying
    // Otherwise: sweep the pool token as-is
    if (isBoostedToken0 && token0Unwrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [
        token0.address,
        isToken0Native ? ADDRESS_THIS : recipient,
        CONTRACT_BALANCE,
        0,
      ])
      if (isToken0Native) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      }
    } else if (isToken0Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token0.address, recipient, 0])
    }

    // Token1: If boosted AND unwrap requested → unwrap to underlying
    // Otherwise: sweep the pool token as-is
    if (isBoostedToken1 && token1Unwrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [
        token1.address,
        isToken1Native ? ADDRESS_THIS : recipient,
        CONTRACT_BALANCE,
        0,
      ])
      if (isToken1Native) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      }
    } else if (isToken1Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token1.address, recipient, 0])
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 6: Burn NFT (if requested and removing 100% liquidity)
    // ═══════════════════════════════════════════════════════════
    if (burnToken && liquidityPercentage.equalTo(new Percent(1))) {
      const encodedBurnCall = encodeBurn(BigNumber.from(tokenId))
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [encodedBurnCall])
    }

    return OmegaRouter.encodePlan(planner, BigNumber.from(0), { deadline })
  }

  /**
   * Produces the on-chain method name and parameters to collect fees from a position
   * Supports boosted pools with automatic unwrap of ERC4626 tokens
   * @param token0 The token0 in the pool
   * @param token1 The token1 in the pool
   * @param options Options for collecting fees
   */
  public static collectCallParameters(
    token0: AnyToken,
    token1: AnyToken,
    options: OmegaCollectOptions
  ): MethodParameters {
    const planner = new RoutePlanner()

    const { tokenId, recipient, permit, token0Unwrap, token1Unwrap } = options

    const isToken0Native = unwrappedToken(token0Unwrap && token0.isBoosted ? token0.underlying : token0).isNative
    const isToken1Native = unwrappedToken(token1Unwrap && token1.isBoosted ? token1.underlying : token1).isNative

    // ═══════════════════════════════════════════════════════════
    // STEP 1: ERC721 Permit (if provided)
    // ═══════════════════════════════════════════════════════════
    if (permit) {
      const encodedPermit = encodeERC721Permit({
        spender: ROUTER_ADDRESS,
        tokenId: BigNumber.from(tokenId),
        deadline: permit.deadline.toString(),
        v: permit.v,
        r: permit.r,
        s: permit.s,
      })
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_PERMIT, [encodedPermit])
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Collect fees to router
    // ═══════════════════════════════════════════════════════════
    // IMPORTANT: recipient must be ROUTER_ADDRESS for tokens to be available for unwrap/sweep
    const maxUint128 = BigNumber.from(2).pow(128).sub(1).toString()
    const encodedCollectCall = encodeCollect({
      tokenId: BigNumber.from(tokenId),
      recipient: ROUTER_ADDRESS,
      amount0Max: maxUint128,
      amount1Max: maxUint128,
    })
    planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [encodedCollectCall])

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Unwrap or Sweep tokens to recipient
    // ═══════════════════════════════════════════════════════════
    // Token0: If unwrap requested → unwrap boosted to underlying
    // Otherwise: sweep the pool token as-is
    if (token0Unwrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [
        token0.address,
        isToken0Native ? ADDRESS_THIS : recipient,
        CONTRACT_BALANCE,
        0,
      ])
      if (isToken0Native) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      }
    } else if (isToken0Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token0.address, recipient, 0])
    }

    // Token1: If unwrap requested → unwrap boosted to underlying
    // Otherwise: sweep the pool token as-is
    if (token1Unwrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [
        token1.address,
        isToken1Native ? ADDRESS_THIS : recipient,
        CONTRACT_BALANCE,
        0,
      ])
      if (isToken1Native) {
        planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
      }
    } else if (isToken1Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token1.address, recipient, 0])
    }

    return OmegaRouter.encodePlan(planner, BigNumber.from(0))
  }

  /**
   * Encodes a planned route into a method name and parameters for the Router contract.
   * @param planner the planned route
   * @param nativeCurrencyValue the native currency value of the planned route
   * @param config the router config
   */
  private static encodePlan(
    planner: RoutePlanner,
    nativeCurrencyValue: BigNumber,
    config: OmegaRouterConfig = {}
  ): MethodParameters {
    const { commands, inputs } = planner
    const functionSignature = config.deadline ? 'execute(bytes,bytes[],uint256)' : 'execute(bytes,bytes[])'
    const parameters = config.deadline ? [commands, inputs, config.deadline] : [commands, inputs]
    const calldata = OmegaRouter.INTERFACE.encodeFunctionData(functionSignature, parameters)
    return { calldata, value: nativeCurrencyValue.toHexString() }
  }
}
