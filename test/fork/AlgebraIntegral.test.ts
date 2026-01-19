import { expect } from 'chai'
import { Route, TradeType } from '@cryptoalgebra/integral-sdk'
import { BASE_USDC, BASE_WETH } from '../shared/tokens'
import { createMockIntegralPool, createOmegaTrade, expandTo18DecimalsBN, expandTo6DecimalsBN } from '../shared/helpers'
import { DEADLINE, ZERO_ADDRESS, SLIPPAGE } from '../shared/constants'
import { executeRouterCalldata, DEX } from '../shared/executeRouter'
import { getInputTokenPermit } from '../shared/permit2'
import { setupTestEnvironment, TestContext } from '../shared/setupTestEnvironment'

describe('Algebra Integral Tests:', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await setupTestEnvironment()
  })

  describe('Trade with Permit2, giving approval every time', () => {
    beforeEach(async () => {
      const { trader, contracts } = ctx
      await contracts.permit2.connect(trader).approve(BASE_USDC.address, ZERO_ADDRESS, 0, 0)
    })

    it('exactIn, permiting the exact amount', async () => {
      const { trader, routerSDK, contracts } = ctx
      const amountIn = expandTo6DecimalsBN(100)
      const minAmountOut = expandTo18DecimalsBN(0.02)
      const inputTokenPermit = await getInputTokenPermit(BASE_USDC, amountIn, trader, contracts.permit2)

      const pool = createMockIntegralPool(BASE_USDC, BASE_WETH)
      const route = new Route([pool], BASE_USDC, BASE_WETH)
      const trade = createOmegaTrade(route, amountIn, minAmountOut, TradeType.EXACT_INPUT)

      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        feeOnTransfer: false,
        deadline: DEADLINE,
        inputTokenPermit,
      })

      const { wethBalanceBefore, wethBalanceAfter, usdcBalanceBefore, usdcBalanceAfter } = await executeRouterCalldata(
        callParameters,
        trader,
        contracts.weth,
        contracts.dai,
        contracts.usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(minAmountOut)
      expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.eq(amountIn)
    })

    it('exactOut, permiting with slippage', async () => {
      const { trader, routerSDK, contracts } = ctx
      const maxAmountIn = expandTo6DecimalsBN(1000)
      const amountOut = expandTo18DecimalsBN(0.03)
      const permitAmount = maxAmountIn.mul(105).div(100) // 5% extra for slippage
      const inputTokenPermit = await getInputTokenPermit(BASE_USDC, permitAmount, trader, contracts.permit2)

      const pool = createMockIntegralPool(BASE_USDC, BASE_WETH)
      const route = new Route([pool], BASE_USDC, BASE_WETH)
      const trade = createOmegaTrade(route, maxAmountIn, amountOut, TradeType.EXACT_OUTPUT)

      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        feeOnTransfer: false,
        deadline: DEADLINE,
        inputTokenPermit,
      })

      const { wethBalanceBefore, wethBalanceAfter, usdcBalanceBefore, usdcBalanceAfter } = await executeRouterCalldata(
        callParameters,
        trader,
        contracts.weth,
        contracts.dai,
        contracts.usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(amountOut)
      expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.lte(maxAmountIn)
    })
  })

  describe('ERC20 --> ERC20', () => {
    it('exactIn swap', async () => {
      const { trader, routerSDK, contracts } = ctx
      const amountIn = expandTo6DecimalsBN(500)
      const minAmountOut = expandTo18DecimalsBN(0.03)

      const pool = createMockIntegralPool(BASE_USDC, BASE_WETH)
      const route = new Route([pool], BASE_USDC, BASE_WETH)
      const trade = createOmegaTrade(route, amountIn, minAmountOut, TradeType.EXACT_INPUT)

      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        feeOnTransfer: false,
        deadline: DEADLINE,
      })

      const { wethBalanceBefore, wethBalanceAfter, usdcBalanceBefore, usdcBalanceAfter } = await executeRouterCalldata(
        callParameters,
        trader,
        contracts.weth,
        contracts.dai,
        contracts.usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(minAmountOut)
      expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.eq(amountIn)
    })

    it('exactOut swap', async () => {
      const { trader, routerSDK, contracts } = ctx
      const maxAmountIn = expandTo6DecimalsBN(1000)
      const amountOut = expandTo18DecimalsBN(0.03)

      const pool = createMockIntegralPool(BASE_USDC, BASE_WETH)
      const route = new Route([pool], BASE_USDC, BASE_WETH)

      const trade = createOmegaTrade(route, maxAmountIn, amountOut, TradeType.EXACT_OUTPUT)
      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        feeOnTransfer: false,
        deadline: DEADLINE,
      })

      const { wethBalanceBefore, wethBalanceAfter, usdcBalanceBefore, usdcBalanceAfter } = await executeRouterCalldata(
        callParameters,
        trader,
        contracts.weth,
        contracts.dai,
        contracts.usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.eq(amountOut)
      expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.lte(maxAmountIn)
    })
  })

  describe('ERC20 --> WETH', () => {
    it('exactIn swap', async () => {
      const { trader, routerSDK, contracts } = ctx
      const amountIn = expandTo6DecimalsBN(500)
      const minAmountOut = expandTo18DecimalsBN(0.03)

      const pool = createMockIntegralPool(BASE_USDC, BASE_WETH)
      const route = new Route([pool], BASE_USDC, BASE_WETH)
      const trade = createOmegaTrade(route, amountIn, minAmountOut, TradeType.EXACT_INPUT)
      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        feeOnTransfer: false,
        deadline: DEADLINE,
      })

      const { wethBalanceBefore, wethBalanceAfter, usdcBalanceBefore, usdcBalanceAfter } = await executeRouterCalldata(
        callParameters,
        trader,
        contracts.weth,
        contracts.dai,
        contracts.usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(minAmountOut)
      expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.eq(amountIn)
    })

    it('exactOut swap', async () => {
      const { trader, routerSDK, contracts } = ctx
      const maxAmountIn = expandTo6DecimalsBN(1000)
      const amountOut = expandTo18DecimalsBN(0.03)

      const pool = createMockIntegralPool(BASE_USDC, BASE_WETH)
      const route = new Route([pool], BASE_USDC, BASE_WETH)
      const trade = createOmegaTrade(route, maxAmountIn, amountOut, TradeType.EXACT_OUTPUT)

      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        feeOnTransfer: false,
        deadline: DEADLINE,
      })

      const { wethBalanceBefore, wethBalanceAfter, usdcBalanceBefore, usdcBalanceAfter } = await executeRouterCalldata(
        callParameters,
        trader,
        contracts.weth,
        contracts.dai,
        contracts.usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.eq(amountOut)
      expect(usdcBalanceBefore.sub(usdcBalanceAfter)).to.be.lte(maxAmountIn)
    })
  })

  describe('WETH --> ERC20', () => {
    it('exactIn swap', async () => {
      const { trader, routerSDK, contracts } = ctx
      const amountIn = expandTo18DecimalsBN(0.2)
      const minAmountOut = expandTo6DecimalsBN(80)

      const pool = createMockIntegralPool(BASE_WETH, BASE_USDC)
      const route = new Route([pool], BASE_WETH, BASE_USDC)
      const trade = createOmegaTrade(route, amountIn, minAmountOut, TradeType.EXACT_INPUT)
      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        feeOnTransfer: false,
        deadline: DEADLINE,
      })

      const { wethBalanceBefore, wethBalanceAfter, usdcBalanceBefore, usdcBalanceAfter } = await executeRouterCalldata(
        callParameters,
        trader,
        contracts.weth,
        contracts.dai,
        contracts.usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(wethBalanceBefore.sub(wethBalanceAfter)).to.be.eq(amountIn)
      expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.gte(minAmountOut)
    })

    it('exactOut swap', async () => {
      const { trader, routerSDK, contracts } = ctx
      const maxAmountIn = expandTo18DecimalsBN(0.5)
      const amountOut = expandTo6DecimalsBN(80)

      const pool = createMockIntegralPool(BASE_WETH, BASE_USDC)
      const route = new Route([pool], BASE_WETH, BASE_USDC)
      const trade = createOmegaTrade(route, maxAmountIn, amountOut, TradeType.EXACT_OUTPUT)
      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        feeOnTransfer: false,
        deadline: DEADLINE,
      })

      const { wethBalanceBefore, wethBalanceAfter, usdcBalanceBefore, usdcBalanceAfter } = await executeRouterCalldata(
        callParameters,
        trader,
        contracts.weth,
        contracts.dai,
        contracts.usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      expect(wethBalanceBefore.sub(wethBalanceAfter)).to.be.lte(maxAmountIn)
      expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.eq(amountOut)
    })
  })
})
