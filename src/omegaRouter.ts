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
} from '@cryptoalgebra/integral-sdk'
import { Interface } from '@ethersproject/abi'
import { BigNumber, BigNumberish } from 'ethers'
import { CommandType, RoutePlanner } from './utils/routerCommands'
import { encodePermit, Permit2Permit } from './utils/inputTokens'
import { OmegaTrade, SwapOptions } from './entities/actions/omega'
import { Address } from 'viem'
import { ethers } from 'ethers'
import { omegaRouterAbi } from './abis'
import { MSG_SENDER, ADDRESS_THIS, CONTRACT_BALANCE, ROUTER_ADDRESS } from './constants'

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

export interface OmegaAddLiquidityOptions {
  slippageTolerance: Percent
  deadline: BigNumberish
  tokenId: BigNumberish
  useNative?: boolean
  token0Permit: Permit2Permit
  token1Permit: Permit2Permit
  // Underlying amounts to wrap. If provided, will wrap underlying → boosted before increasing
  amount0Underlying?: CurrencyAmount<Currency>
  amount1Underlying?: CurrencyAmount<Currency>
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
    deadline: string
  }
  token0Unwrap?: boolean // unwrap token0 boosted → underlying
  token1Unwrap?: boolean // unwrap token1 boosted → underlying
}

export interface OmegaCollectOptions {
  tokenId: BigNumberish
  expectedCurrencyOwed0: BigNumber
  expectedCurrencyOwed1: BigNumber
  recipient: Address
  permit?: {
    v: number
    r: string
    s: string
    deadline: string
  }
  token0Unwrap?: boolean
  token1Unwrap?: boolean
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
   * @param position The position to remove liquidity from
   * @param options Options for the transaction
   */
  public static removeCallParameters(position: Position, options: OmegaRemoveLiquidityOptions): MethodParameters {
    const planner = new RoutePlanner()

    const { tokenId, liquidityPercentage, slippageTolerance, deadline, burnToken, permit, token0Unwrap, token1Unwrap } =
      options

    const token0 = position.pool.token0
    const token1 = position.pool.token1
    const isBoostedToken0 = token0.isBoosted
    const isBoostedToken1 = token1.isBoosted

    // Calculate liquidity to remove
    const partialPosition = new Position({
      pool: position.pool,
      liquidity: BigNumber.from(
        liquidityPercentage.multiply(position.liquidity.toString()).quotient.toString()
      ).toString(),
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
    })

    const { amount0: amount0Min, amount1: amount1Min } = partialPosition.burnAmountsWithSlippage(slippageTolerance)

    const abi = new ethers.utils.AbiCoder()

    // Add permit if provided (following test pattern)
    if (permit) {
      const permitSignature = 'permit(address,uint256,uint256,uint8,bytes32,bytes32)'
      const encodedParams = abi.encode(
        ['address', 'uint256', 'uint256', 'uint8', 'bytes32', 'bytes32'],
        [ROUTER_ADDRESS, tokenId.toString(), permit.deadline, permit.v, permit.r, permit.s]
      )
      const functionSelector = ethers.utils.id(permitSignature).substring(0, 10)
      const encodedPermit = functionSelector + encodedParams.substring(2)
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_PERMIT, [encodedPermit])
    }

    // Decrease liquidity (following test pattern)
    const decreaseLiquiditySignature = 'decreaseLiquidity((uint256,uint128,uint256,uint256,uint256))'
    const DECREASE_LIQUIDITY_STRUCT =
      '(uint256 tokenId,uint256 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)'
    const decreaseParams = abi.encode(
      [DECREASE_LIQUIDITY_STRUCT],
      [
        {
          tokenId: tokenId.toString(),
          liquidity: partialPosition.liquidity.toString(),
          amount0Min: amount0Min.toString(),
          amount1Min: amount1Min.toString(),
          deadline: deadline.toString(),
        },
      ]
    )
    const decreaseSelector = ethers.utils.id(decreaseLiquiditySignature).substring(0, 10)
    const decreaseCall = decreaseSelector + decreaseParams.substring(2)
    planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [decreaseCall])

    // Collect tokens (following test pattern)
    // IMPORTANT: recipient must be router.address (not ADDRESS_THIS) for tokens to be available for unwrap/sweep
    const collectSignature = 'collect((uint256,address,uint128,uint128))'
    const COLLECT_STRUCT = '(uint256 tokenId,address recipient,uint256 amount0Max,uint256 amount1Max)'
    const maxUint128 = BigNumber.from(2).pow(128).sub(1).toString()
    const collectParams = abi.encode(
      [COLLECT_STRUCT],
      [
        {
          tokenId: tokenId.toString(),
          recipient: ROUTER_ADDRESS,
          amount0Max: maxUint128,
          amount1Max: maxUint128,
        },
      ]
    )
    const collectSelector = ethers.utils.id(collectSignature).substring(0, 10)
    const collectCall = collectSelector + collectParams.substring(2)
    planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [collectCall])

    // Unwrap and send to user
    // If boosted token AND unwrap requested: unwrap to underlying
    // Otherwise: sweep the pool token (boosted or not) as-is
    console.log('🔍 Token0 handling:', {
      isBoostedToken0,
      token0Unwrap,
      condition: isBoostedToken0 && token0Unwrap,
      willUse: isBoostedToken0 && token0Unwrap ? 'ERC4626_UNWRAP' : 'SWEEP',
    })

    if (isBoostedToken0 && token0Unwrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [token0.address, MSG_SENDER, CONTRACT_BALANCE, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token0.address, MSG_SENDER, 0])
    }

    console.log('🔍 Token1 handling:', {
      isBoostedToken1,
      token1Unwrap,
      condition: isBoostedToken1 && token1Unwrap,
      willUse: isBoostedToken1 && token1Unwrap ? 'ERC4626_UNWRAP' : 'SWEEP',
    })

    if (isBoostedToken1 && token1Unwrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [token1.address, MSG_SENDER, CONTRACT_BALANCE, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token1.address, MSG_SENDER, 0])
    }

    // Burn NFT if requested (following test pattern)
    if (burnToken && liquidityPercentage.equalTo(new Percent(1))) {
      const burnSignature = 'burn(uint256)'
      const burnParams = abi.encode(['uint256'], [tokenId.toString()])
      const burnSelector = ethers.utils.id(burnSignature).substring(0, 10)
      const burnCall = burnSelector + burnParams.substring(2)
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [burnCall])
    }

    return OmegaRouter.encodePlan(planner, BigNumber.from(0), { deadline })
  }

  /**
   * Produces the on-chain method name and parameters to collect fees from a position
   * @param options Options for collecting fees
   */
  public static collectCallParameters(
    token0Address: Address,
    token1Address: Address,
    options: OmegaCollectOptions
  ): MethodParameters {
    const planner = new RoutePlanner()

    const { tokenId, recipient, permit, token0Unwrap, token1Unwrap } = options

    const abi = new ethers.utils.AbiCoder()

    // Add permit if provided (following test pattern)
    if (permit) {
      const permitSignature = 'permit(address,uint256,uint256,uint8,bytes32,bytes32)'
      const encodedParams = abi.encode(
        ['address', 'uint256', 'uint256', 'uint8', 'bytes32', 'bytes32'],
        [ROUTER_ADDRESS, tokenId.toString(), permit.deadline, permit.v, permit.r, permit.s]
      )
      const functionSelector = ethers.utils.id(permitSignature).substring(0, 10)
      const encodedPermit = functionSelector + encodedParams.substring(2)
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_PERMIT, [encodedPermit])
    }

    // Collect (following test pattern)
    // IMPORTANT: recipient must be router.address (not ADDRESS_THIS) for tokens to be available for unwrap/sweep
    const collectSignature = 'collect((uint256,address,uint128,uint128))'
    const COLLECT_STRUCT = '(uint256 tokenId,address recipient,uint256 amount0Max,uint256 amount1Max)'
    const maxUint128 = BigNumber.from(2).pow(128).sub(1).toString()
    const collectParams = abi.encode(
      [COLLECT_STRUCT],
      [
        {
          tokenId: tokenId.toString(),
          recipient: ROUTER_ADDRESS,
          amount0Max: maxUint128,
          amount1Max: maxUint128,
        },
      ]
    )
    const collectSelector = ethers.utils.id(collectSignature).substring(0, 10)
    const collectCall = collectSelector + collectParams.substring(2)
    planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [collectCall])

    // Unwrap and send to recipient
    // Following test pattern: unwrap directly to final recipient if unwrap requested, otherwise sweep
    if (token0Unwrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [token0Address, recipient, CONTRACT_BALANCE, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token0Address, recipient, 0])
    }

    if (token1Unwrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [token1Address, recipient, CONTRACT_BALANCE, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token1Address, recipient, 0])
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
