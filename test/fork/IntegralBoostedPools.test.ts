import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ADDRESS_ZERO, BoostedRoute, TradeType } from '@cryptoalgebra/integral-sdk'
import { INTEGRAL_NFT_POSITION_MANAGER_BASE, OMEGA_ROUTER_ADDRESS } from '../shared/addresses'
import { BASE_USDC, BASE_WETH, BASE_DAI, BASE_WA_WETH, BASE_WM_USDC } from '../shared/tokens'
import {
  createMockIntegralPool,
  createOmegaTrade,
  encodePriceSqrt,
  expandTo18DecimalsBN,
  expandTo6DecimalsBN,
  getMaxTick,
  getMinTick,
} from '../shared/helpers'
import { MAX_UINT, DEADLINE, SLIPPAGE } from '../shared/constants'
import { disablePluginFactory } from '../shared/mainnetForkHelpers'
import { executeRouterCalldata, DEX } from '../shared/executeRouter'
import { setupTestEnvironment, TestContext } from '../shared/setupTestEnvironment'

describe('Algebra Integral Boosted Pools Tests:', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await setupTestEnvironment()
  })

  describe('Boosted Pool Swaps', () => {
    beforeEach('Disable plugin factory', async () => {
      await disablePluginFactory()
    })

    beforeEach('Create and fund [wmUSDC/waWETH] pool', async () => {
      const { deployer, contracts } = ctx
      const { usdc, weth, waWETH, wmUSDC, nfpm } = contracts

      // Approve and deposit into ERC4626 vaults
      await weth.connect(deployer).approve(BASE_WA_WETH.address, MAX_UINT)
      await usdc.connect(deployer).approve(BASE_WM_USDC.address, MAX_UINT)
      await waWETH.connect(deployer).deposit(expandTo18DecimalsBN(21.4), deployer.address)
      await wmUSDC.connect(deployer).deposit(expandTo6DecimalsBN(90_000), deployer.address)

      const waWETHBalance = await waWETH.balanceOf(deployer.address)
      const wmUSDCBalance = await wmUSDC.balanceOf(deployer.address)

      // Create and initialize the boosted pool
      await nfpm
        .connect(deployer)
        .createAndInitializePoolIfNecessary(
          wmUSDC.address,
          waWETH.address,
          ADDRESS_ZERO,
          encodePriceSqrt(waWETHBalance, wmUSDCBalance),
          '0x'
        )

      // Approve and add liquidity
      await waWETH.connect(deployer).approve(INTEGRAL_NFT_POSITION_MANAGER_BASE, MAX_UINT)
      await wmUSDC.connect(deployer).approve(INTEGRAL_NFT_POSITION_MANAGER_BASE, MAX_UINT)
      await nfpm.connect(deployer).mint({
        token0: wmUSDC.address,
        token1: waWETH.address,
        deployer: ADDRESS_ZERO,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: wmUSDCBalance,
        amount1Desired: waWETHBalance,
        amount0Min: 0,
        amount1Min: 0,
        recipient: deployer.address,
        deadline: DEADLINE,
      })
    })

    beforeEach('Create and fund [DAI/wmUSDC] pool', async () => {
      const { deployer, contracts } = ctx
      const { usdc, dai, wmUSDC, nfpm } = contracts

      const daiAmount = expandTo18DecimalsBN(50_000)
      const wusdcAmount = expandTo6DecimalsBN(50_000)

      // Approve and deposit into vault to get wmUSDC
      await usdc.connect(deployer).approve(BASE_WM_USDC.address, MAX_UINT)
      await wmUSDC.connect(deployer).deposit(wusdcAmount, deployer.address)

      // Create and initialize the pool
      await nfpm
        .connect(deployer)
        .createAndInitializePoolIfNecessary(dai.address, wmUSDC.address, ADDRESS_ZERO, encodePriceSqrt(1, 1), '0x')

      // Approve and add liquidity
      await dai.connect(deployer).approve(INTEGRAL_NFT_POSITION_MANAGER_BASE, MAX_UINT)
      await wmUSDC.connect(deployer).approve(INTEGRAL_NFT_POSITION_MANAGER_BASE, MAX_UINT)
      await nfpm.connect(deployer).mint({
        token0: dai.address,
        token1: wmUSDC.address,
        deployer: ADDRESS_ZERO,
        tickLower: getMinTick(60),
        tickUpper: getMaxTick(60),
        amount0Desired: daiAmount,
        amount1Desired: await wmUSDC.balanceOf(deployer.address),
        amount0Min: 0,
        amount1Min: 0,
        recipient: deployer.address,
        deadline: DEADLINE,
      })
    })

    it('100 USDC wrap -> wmUSDC swap -> waWETH unwrap -> WETH', async () => {
      const { trader, routerSDK, contracts } = ctx
      const { weth, dai, usdc } = contracts

      const amountIn = expandTo6DecimalsBN(100)

      const pool = createMockIntegralPool(BASE_WM_USDC, BASE_WA_WETH)
      const route = new BoostedRoute([pool], BASE_USDC, BASE_WETH)
      const trade = createOmegaTrade(route, amountIn, BigNumber.from(0), TradeType.EXACT_INPUT)

      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        deadline: DEADLINE,
        feeOnTransfer: false,
      })

      const { wethBalanceBefore, wethBalanceAfter, v3SwapEventArgs } = await executeRouterCalldata(
        callParameters,
        trader,
        weth,
        dai,
        usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      const wethReceived = wethBalanceAfter.sub(wethBalanceBefore)
      expect(wethReceived).to.be.gt(0)

      if (v3SwapEventArgs) {
        const amountOut = v3SwapEventArgs.amount1.mul(-1)
        // waWETH amount is less than WETH after unwrap due to yield accrual
        expect(wethReceived).to.be.gt(amountOut)
      }
    })

    it('0.02 WETH wrap -> waWETH swap -> wmUSDC unwrap -> USDC', async () => {
      const { trader, routerSDK, contracts } = ctx
      const { weth, dai, usdc } = contracts

      const amountIn = expandTo18DecimalsBN(0.02)

      const pool = createMockIntegralPool(BASE_WA_WETH, BASE_WM_USDC)
      const route = new BoostedRoute([pool], BASE_WETH, BASE_USDC)
      const trade = createOmegaTrade(route, amountIn, BigNumber.from(0), TradeType.EXACT_INPUT)

      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        deadline: DEADLINE,
        feeOnTransfer: false,
      })

      const { usdcBalanceBefore, usdcBalanceAfter, v3SwapEventArgs } = await executeRouterCalldata(
        callParameters,
        trader,
        weth,
        dai,
        usdc,
        DEX.ALGEBRA_INTEGRAL
      )

      const usdcReceived = usdcBalanceAfter.sub(usdcBalanceBefore)
      expect(usdcReceived).to.be.gt(0)

      if (v3SwapEventArgs) {
        const amountOut = v3SwapEventArgs.amount0.mul(-1)
        // wmUSDC amount is less than USDC after unwrap (compare in 18 decimals)
        expect(usdcReceived.mul(BigNumber.from(10).pow(12))).to.be.gt(amountOut)
      }
    })

    it('exactOut wrap: USDC -> wmUSDC -> waWETH -> WETH', async () => {
      const { routerSDK, contracts, trader } = ctx
      const { weth, dai, usdc, wmUSDC, waWETH } = contracts

      const amountOutWETH = expandTo18DecimalsBN(0.01)
      const maxUSDCIn = expandTo6DecimalsBN(50)

      // Boosted pool WM_USDC/WA_WETH
      const pool = createMockIntegralPool(BASE_WM_USDC, BASE_WA_WETH)

      // Boosted route USDC -> wmUSDC -> waWETH -> WETH
      const route = new BoostedRoute([pool], BASE_USDC, BASE_WETH)
      const trade = createOmegaTrade(route, maxUSDCIn, amountOutWETH, TradeType.EXACT_OUTPUT)
      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        deadline: DEADLINE,
        feeOnTransfer: false,
      })

      const usdcBalanceBefore = await usdc.balanceOf(trader.address)
      const wethBalanceBefore = await weth.balanceOf(trader.address)

      await executeRouterCalldata(callParameters, trader, weth, dai, usdc, DEX.ALGEBRA_INTEGRAL)

      const usdcBalanceAfter = await usdc.balanceOf(trader.address)
      const wethBalanceAfter = await weth.balanceOf(trader.address)

      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(amountOutWETH)

      const usdcSpent = usdcBalanceBefore.sub(usdcBalanceAfter)
      expect(usdcSpent).to.be.lt(maxUSDCIn)
      expect(usdcSpent).to.be.gt(0)

      expect(await usdc.balanceOf(OMEGA_ROUTER_ADDRESS)).to.equal(0)
      expect(await wmUSDC.balanceOf(OMEGA_ROUTER_ADDRESS)).to.equal(0)
      expect(await waWETH.balanceOf(OMEGA_ROUTER_ADDRESS)).to.equal(0)
      expect(await weth.balanceOf(OMEGA_ROUTER_ADDRESS)).to.equal(0)
    })

    it('exactOut multihop: DAI -> wmUSDC -> waWETH -> WETH', async () => {
      const { routerSDK, contracts, trader } = ctx
      const { weth, dai, usdc, wmUSDC, waWETH } = contracts
      const amountOutWETH = expandTo18DecimalsBN(0.01)
      const maxDAIIn = expandTo18DecimalsBN(100)

      const poolAB = createMockIntegralPool(BASE_DAI, BASE_WM_USDC)
      const poolBC = createMockIntegralPool(BASE_WM_USDC, BASE_WA_WETH)

      // Path: DAI -> [DAI/wmUSDC pool] -> wmUSDC -> [wmUSDC/waWETH pool] -> waWETH -> WETH (unwrap)
      const route = new BoostedRoute([poolAB, poolBC], BASE_DAI, BASE_WETH)
      const trade = createOmegaTrade(route, maxDAIIn, amountOutWETH, TradeType.EXACT_OUTPUT)
      const callParameters = routerSDK.swapCallParameters(trade, {
        recipient: trader.address,
        slippageTolerance: SLIPPAGE,
        deadline: DEADLINE,
        feeOnTransfer: false,
      })

      const daiBalanceBefore = await dai.balanceOf(trader.address)
      const wethBalanceBefore = await weth.balanceOf(trader.address)

      await executeRouterCalldata(callParameters, trader, weth, dai, usdc, DEX.ALGEBRA_INTEGRAL)

      const daiBalanceAfter = await dai.balanceOf(trader.address)
      const wethBalanceAfter = await weth.balanceOf(trader.address)

      expect(wethBalanceAfter.sub(wethBalanceBefore)).to.be.gte(amountOutWETH)

      const daiSpent = daiBalanceBefore.sub(daiBalanceAfter)
      expect(daiSpent).to.be.lt(maxDAIIn)
      expect(daiSpent).to.be.gt(0)

      expect(await dai.balanceOf(OMEGA_ROUTER_ADDRESS)).to.equal(0)
      expect(await wmUSDC.balanceOf(OMEGA_ROUTER_ADDRESS)).to.equal(0)
      expect(await waWETH.balanceOf(OMEGA_ROUTER_ADDRESS)).to.equal(0)
      expect(await weth.balanceOf(OMEGA_ROUTER_ADDRESS)).to.equal(0)
    })
  })
})
