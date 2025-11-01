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
  BoostedToken,
} from '@cryptoalgebra/integral-sdk'
import { Interface } from '@ethersproject/abi'
import { BigNumber, BigNumberish } from 'ethers'
import { CommandType, RoutePlanner } from './utils/routerCommands'
import { encodePermit, Permit2Permit } from './utils/inputTokens'
import { OmegaTrade, SwapOptions } from './entities/actions/omega'
import { Address } from 'viem'
import { ethers } from 'ethers'
import { omegaRouterAbi } from './abis'
import { ROUTER_ADDRESS } from './constants/addresses'

// Helper to get address from Currency (handles ExtendedNative)
function getCurrencyAddress(currency: Currency): string {
  return currency.isToken ? currency.address : currency.wrapped.address
}

export type OmegaRouterConfig = {
  sender?: string // address
  deadline?: BigNumberish
}

export interface MintOptions {
  recipient: Address
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
}

export interface AddLiquidityOptions {
  slippageTolerance: Percent
  deadline: BigNumberish
  tokenId: BigNumberish
  useNative?: boolean
  token0Permit?: Permit2Permit
  token1Permit?: Permit2Permit
  // Underlying amounts to wrap. If provided, will wrap underlying → boosted before increasing
  amount0Underlying?: CurrencyAmount<Currency>
  amount1Underlying?: CurrencyAmount<Currency>
}

export interface RemoveLiquidityOptions {
  tokenId: BigNumberish
  liquidityPercentage: Percent
  slippageTolerance: Percent
  deadline: BigNumberish
  burnToken?: boolean
  permit?: {
    v: number
    r: string
    s: string
  }
  token0Unwrap?: boolean // unwrap token0 boosted → underlying
  token1Unwrap?: boolean // unwrap token1 boosted → underlying
}

export interface CollectOptions {
  tokenId: BigNumberish
  expectedCurrencyOwed0: BigNumber
  expectedCurrencyOwed1: BigNumber
  recipient: Address
  permit?: {
    v: number
    r: string
    s: string
  }
  token0Unwrap?: boolean
  token1Unwrap?: boolean
}

export abstract class OmegaRouter {
  public static INTERFACE: Interface = new Interface(omegaRouterAbi)

  public static swapCallParameters(
    trade: Trade<Currency, Currency, TradeType>,
    options: SwapOptions
  ): MethodParameters {
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

    omegaTrade.encode(planner)
    return OmegaRouter.encodePlan(planner, nativeCurrencyValue, {
      deadline: options.deadline ? BigNumber.from(options.deadline) : undefined,
    })
  }

  /**
   * Produces the on-chain method name and parameters to mint a new position (create liquidity)
   * Supports boosted pools with automatic wrap/unwrap of ERC4626 tokens
   * @param position The position to mint
   * @param options Options for the transaction
   */
  public static addCallParameters(position: Position, options: MintOptions): MethodParameters {
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
    } = options

    const token0 = unwrappedToken(position.pool.token0)
    const token1 = unwrappedToken(position.pool.token1)
    const isBoostedToken0 = token0 instanceof BoostedToken
    const isBoostedToken1 = token1 instanceof BoostedToken

    // Determine if wrapping is needed based on whether underlying amounts are provided
    const token0Wrap = !!amount0Underlying
    const token1Wrap = !!amount1Underlying

    // Check if we're dealing with native currency (ETH)
    // If wrapping, check if underlying is native; otherwise check if pool token is native
    const isToken0Native = useNative && (token0Wrap ? amount0Underlying!.currency.isNative : token0.isNative)
    const isToken1Native = useNative && (token1Wrap ? amount1Underlying!.currency.isNative : token1.isNative)

    // Use underlying amounts if provided (for wrapping scenarios)
    // Otherwise use position amounts (already in pool tokens)
    const { amount0, amount1 } = position.mintAmounts
    const amount0Desired = amount0Underlying
      ? BigNumber.from(amount0Underlying.quotient.toString())
      : BigNumber.from(amount0.toString())
    const amount1Desired = amount1Underlying
      ? BigNumber.from(amount1Underlying.quotient.toString())
      : BigNumber.from(amount1.toString())

    let nativeValue = BigNumber.from(0)

    // Add Permit2 signatures if provided
    if (token0Permit && !isToken0Native) {
      console.log('Adding token0 permit')
      encodePermit(planner, token0Permit)
    }

    if (token1Permit && !isToken1Native) {
      console.log('Adding token1 permit')
      encodePermit(planner, token1Permit)
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Transfer/Wrap Token0
    // ═══════════════════════════════════════════════════════════
    if (isToken0Native) {
      nativeValue = nativeValue.add(amount0Desired)
      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount0Desired.toString()])

      if (isBoostedToken0 && token0Wrap) {
        const underlyingAddress = getCurrencyAddress((token0 as BoostedToken).underlying)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          token0.wrapped.address,
          underlyingAddress,
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          0,
        ])
      }
    } else {
      const underlyingAddress =
        isBoostedToken0 && token0Wrap ? getCurrencyAddress((token0 as BoostedToken).underlying) : token0.wrapped.address
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
        underlyingAddress,
        ROUTER_ADDRESS,
        amount0Desired.toString(),
      ])

      if (isBoostedToken0 && token0Wrap) {
        const underlyingAddr = getCurrencyAddress((token0 as BoostedToken).underlying)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          token0.wrapped.address,
          underlyingAddr,
          ADDRESS_THIS,
          amount0Desired.toString(),
          0,
        ])
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Transfer/Wrap Token1
    // ═══════════════════════════════════════════════════════════
    if (isToken1Native) {
      nativeValue = nativeValue.add(amount1Desired)
      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount1Desired.toString()])

      if (isBoostedToken1 && token1Wrap) {
        const underlyingAddress = getCurrencyAddress((token1 as BoostedToken).underlying)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          token1.wrapped.address,
          underlyingAddress,
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          0,
        ])
      }
    } else {
      const underlyingAddress =
        isBoostedToken1 && token1Wrap ? getCurrencyAddress((token1 as BoostedToken).underlying) : token1.wrapped.address
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
        underlyingAddress,
        ROUTER_ADDRESS,
        amount1Desired.toString(),
      ])

      if (isBoostedToken1 && token1Wrap) {
        const underlyingAddr = getCurrencyAddress((token1 as BoostedToken).underlying)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          token1.wrapped.address,
          underlyingAddr,
          ADDRESS_THIS,
          amount1Desired.toString(),
          0,
        ])
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Mint Position
    // ═══════════════════════════════════════════════════════════
    // Calculate minimum amounts with slippage tolerance
    const { amount0: amount0Min, amount1: amount1Min } = position.mintAmountsWithSlippage(slippageTolerance)

    // Determine amounts for mint:
    // - If token is boosted AND we're wrapping: use CONTRACT_BALANCE (consume all wrapped tokens)
    // - Otherwise: use original amounts
    const mintAmount0Desired = isBoostedToken0 && token0Wrap ? CONTRACT_BALANCE : amount0Desired
    const mintAmount1Desired = isBoostedToken1 && token1Wrap ? CONTRACT_BALANCE : amount1Desired

    // INTEGRAL_MINT expects a struct of parameters (like in test planner)
    // Pass as array which will be encoded with MINT_PARAMS struct type
    planner.addCommand(CommandType.INTEGRAL_MINT, [
      [
        token0.wrapped.address, // token0
        token1.wrapped.address, // token1
        deployer || '0x0000000000000000000000000000000000000000', // deployer
        position.tickLower, // tickLower
        position.tickUpper, // tickUpper
        mintAmount0Desired.toString(), // amount0Desired
        mintAmount1Desired.toString(), // amount1Desired
        amount0Min.toString(), // amount0Min
        amount1Min.toString(), // amount1Min
        recipient, // recipient
        deadline.toString(), // deadline
      ],
    ])

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Refund unused tokens
    // ═══════════════════════════════════════════════════════════
    // Refund token0
    if (isBoostedToken0 && token0Wrap) {
      // Unwrap unused boosted tokens directly to recipient
      planner.addCommand(CommandType.ERC4626_UNWRAP, [token0.wrapped.address, recipient, CONTRACT_BALANCE, 0])
    } else if (isToken0Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    } else {
      // Sweep unused tokens (for non-boosted tokens)
      planner.addCommand(CommandType.SWEEP, [token0.wrapped.address, recipient, 0])
    }

    // Refund token1
    if (isBoostedToken1 && token1Wrap) {
      // Unwrap unused boosted tokens directly to recipient
      planner.addCommand(CommandType.ERC4626_UNWRAP, [token1.wrapped.address, recipient, CONTRACT_BALANCE, 0])
    } else if (isToken1Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [recipient, 0])
    } else {
      // Sweep unused tokens (for non-boosted tokens)
      planner.addCommand(CommandType.SWEEP, [token1.wrapped.address, recipient, 0])
    }

    return OmegaRouter.encodePlan(planner, nativeValue, { deadline })
  }

  /**
   * Produces the on-chain method name and parameters to increase liquidity in existing position
   * @param position The position with increased liquidity
   * @param options Options for the transaction
   */
  public static increaseCallParameters(position: Position, options: AddLiquidityOptions): MethodParameters {
    const planner = new RoutePlanner()

    const {
      tokenId,
      slippageTolerance,
      deadline,
      useNative,
      token0Permit,
      token1Permit,
      amount0Underlying,
      amount1Underlying,
    } = options

    const token0 = position.pool.token0
    const token1 = position.pool.token1
    const isBoostedToken0 = token0 instanceof BoostedToken
    const isBoostedToken1 = token1 instanceof BoostedToken

    // Determine if wrapping is needed based on whether underlying amounts are provided
    const token0Wrap = !!amount0Underlying
    const token1Wrap = !!amount1Underlying

    // Check if we're dealing with native currency (ETH)
    const isToken0Native = useNative && (token0Wrap ? amount0Underlying!.currency.isNative : token0.isNative)
    const isToken1Native = useNative && (token1Wrap ? amount1Underlying!.currency.isNative : token1.isNative)

    // Use underlying amounts if provided (for wrapping scenarios)
    // Otherwise use position amounts (already in pool tokens)
    const { amount0, amount1 } = position.mintAmounts
    const amount0Desired = amount0Underlying
      ? BigNumber.from(amount0Underlying.quotient.toString())
      : BigNumber.from(amount0.toString())
    const amount1Desired = amount1Underlying
      ? BigNumber.from(amount1Underlying.quotient.toString())
      : BigNumber.from(amount1.toString())

    const minimumAmounts = position.mintAmountsWithSlippage(slippageTolerance)
    const amount0Min = BigNumber.from(minimumAmounts.amount0.toString())
    const amount1Min = BigNumber.from(minimumAmounts.amount1.toString())

    let nativeValue = BigNumber.from(0)

    // Add Permit2 signatures if provided
    if (token0Permit && !isToken0Native) {
      encodePermit(planner, token0Permit)
    }

    if (token1Permit && !isToken1Native) {
      encodePermit(planner, token1Permit)
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Transfer/Wrap Token0
    // ═══════════════════════════════════════════════════════════
    if (isToken0Native) {
      nativeValue = nativeValue.add(amount0Desired)
      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount0Desired.toString()])

      if (isBoostedToken0 && token0Wrap) {
        const underlyingAddress = getCurrencyAddress((token0 as BoostedToken).underlying)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          token0.address,
          underlyingAddress,
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          0,
        ])
      }
    } else {
      const underlyingAddress =
        isBoostedToken0 && token0Wrap ? getCurrencyAddress((token0 as BoostedToken).underlying) : token0.address
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
        underlyingAddress,
        ROUTER_ADDRESS,
        amount0Desired.toString(),
      ])

      if (isBoostedToken0 && token0Wrap) {
        const underlyingAddr = getCurrencyAddress((token0 as BoostedToken).underlying)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          token0.address,
          underlyingAddr,
          ADDRESS_THIS,
          amount0Desired.toString(),
          0,
        ])
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Transfer/Wrap Token1
    // ═══════════════════════════════════════════════════════════
    if (isToken1Native) {
      nativeValue = nativeValue.add(amount1Desired)
      planner.addCommand(CommandType.WRAP_ETH, [ADDRESS_THIS, amount1Desired.toString()])

      if (isBoostedToken1 && token1Wrap) {
        const underlyingAddress = getCurrencyAddress((token1 as BoostedToken).underlying)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          token1.address,
          underlyingAddress,
          ADDRESS_THIS,
          CONTRACT_BALANCE,
          0,
        ])
      }
    } else {
      const underlyingAddress =
        isBoostedToken1 && token1Wrap ? getCurrencyAddress((token1 as BoostedToken).underlying) : token1.address
      planner.addCommand(CommandType.PERMIT2_TRANSFER_FROM, [
        underlyingAddress,
        ROUTER_ADDRESS,
        amount1Desired.toString(),
      ])

      if (isBoostedToken1 && token1Wrap) {
        const underlyingAddr = getCurrencyAddress((token1 as BoostedToken).underlying)
        planner.addCommand(CommandType.ERC4626_WRAP, [
          token1.address,
          underlyingAddr,
          ADDRESS_THIS,
          amount1Desired.toString(),
          0,
        ])
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Increase Liquidity
    // ═══════════════════════════════════════════════════════════
    // Determine amounts for increaseLiquidity:
    // - If token is boosted AND we're wrapping: use CONTRACT_BALANCE (consume all wrapped tokens)
    // - Otherwise: use original amounts
    const increaseAmount0Desired = isBoostedToken0 && token0Wrap ? CONTRACT_BALANCE : amount0Desired
    const increaseAmount1Desired = isBoostedToken1 && token1Wrap ? CONTRACT_BALANCE : amount1Desired

    // Encode increaseLiquidity call (following test pattern)
    const increaseLiquiditySignature = 'increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256))'
    const INCREASE_LIQUIDITY_STRUCT =
      '(uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline)'
    const abi = new ethers.utils.AbiCoder()
    const encodedParams = abi.encode(
      [INCREASE_LIQUIDITY_STRUCT],
      [
        {
          tokenId: tokenId.toString(),
          amount0Desired: increaseAmount0Desired.toString(),
          amount1Desired: increaseAmount1Desired.toString(),
          amount0Min: amount0Min.toString(),
          amount1Min: amount1Min.toString(),
          deadline: deadline.toString(),
        },
      ]
    )
    const functionSelector = ethers.utils.id(increaseLiquiditySignature).substring(0, 10)
    const encodedCall = functionSelector + encodedParams.substring(2)

    planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [encodedCall])

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Refund unused tokens
    // ═══════════════════════════════════════════════════════════
    // Refund token0
    if (isBoostedToken0 && token0Wrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [token0.address, MSG_SENDER, CONTRACT_BALANCE, 0])
    } else if (isToken0Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [MSG_SENDER, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token0.address, MSG_SENDER, 0])
    }

    // Refund token1
    if (isBoostedToken1 && token1Wrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [token1.address, MSG_SENDER, CONTRACT_BALANCE, 0])
    } else if (isToken1Native) {
      planner.addCommand(CommandType.UNWRAP_WETH, [MSG_SENDER, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token1.address, MSG_SENDER, 0])
    }

    return OmegaRouter.encodePlan(planner, nativeValue, { deadline })
  }

  /**
   * Produces the on-chain method name and parameters to remove liquidity from a position
   * @param position The position to remove liquidity from
   * @param options Options for the transaction
   */
  public static removeCallParameters(position: Position, options: RemoveLiquidityOptions): MethodParameters {
    const planner = new RoutePlanner()

    const { tokenId, liquidityPercentage, slippageTolerance, deadline, burnToken, permit, token0Unwrap, token1Unwrap } =
      options

    const token0 = position.pool.token0
    const token1 = position.pool.token1
    const isBoostedToken0 = token0 instanceof BoostedToken
    const isBoostedToken1 = token1 instanceof BoostedToken

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
        [ROUTER_ADDRESS, tokenId.toString(), deadline.toString(), permit.v, permit.r, permit.s]
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
    const collectSignature = 'collect((uint256,address,uint128,uint128))'
    const COLLECT_STRUCT = '(uint256 tokenId,address recipient,uint256 amount0Max,uint256 amount1Max)'
    const maxUint128 = BigNumber.from(2).pow(128).sub(1).toString()
    const collectParams = abi.encode(
      [COLLECT_STRUCT],
      [
        {
          tokenId: tokenId.toString(),
          recipient: ADDRESS_THIS,
          amount0Max: maxUint128,
          amount1Max: maxUint128,
        },
      ]
    )
    const collectSelector = ethers.utils.id(collectSignature).substring(0, 10)
    const collectCall = collectSelector + collectParams.substring(2)
    planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_CALL, [collectCall])

    // Unwrap and send to user
    // Following test pattern: unwrap directly to final recipient if boosted, otherwise sweep
    if (isBoostedToken0 && token0Unwrap) {
      planner.addCommand(CommandType.ERC4626_UNWRAP, [token0.address, MSG_SENDER, CONTRACT_BALANCE, 0])
    } else {
      planner.addCommand(CommandType.SWEEP, [token0.address, MSG_SENDER, 0])
    }

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
    options: CollectOptions
  ): MethodParameters {
    const planner = new RoutePlanner()

    const { tokenId, recipient, permit, token0Unwrap, token1Unwrap } = options

    const abi = new ethers.utils.AbiCoder()

    // Add permit if provided (following test pattern)
    if (permit) {
      const permitSignature = 'permit(address,uint256,uint256,uint8,bytes32,bytes32)'
      const encodedParams = abi.encode(
        ['address', 'uint256', 'uint256', 'uint8', 'bytes32', 'bytes32'],
        [ROUTER_ADDRESS, tokenId.toString(), Date.now() + 86400, permit.v, permit.r, permit.s]
      )
      const functionSelector = ethers.utils.id(permitSignature).substring(0, 10)
      const encodedPermit = functionSelector + encodedParams.substring(2)
      planner.addCommand(CommandType.INTEGRAL_POSITION_MANAGER_PERMIT, [encodedPermit])
    }

    // Collect (following test pattern)
    const collectSignature = 'collect((uint256,address,uint128,uint128))'
    const COLLECT_STRUCT = '(uint256 tokenId,address recipient,uint256 amount0Max,uint256 amount1Max)'
    const maxUint128 = BigNumber.from(2).pow(128).sub(1).toString()
    const collectParams = abi.encode(
      [COLLECT_STRUCT],
      [
        {
          tokenId: tokenId.toString(),
          recipient: ADDRESS_THIS,
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
