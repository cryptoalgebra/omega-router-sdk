import { BigNumber } from 'ethers'
import {
  BASE_USDC,
  BASE_WA_USDC,
  createOmegaTrade,
  DEADLINE,
  executeRouterCalldata,
  expandTo6DecimalsBN,
  setupTestEnvironment,
  SLIPPAGE,
  TestContext,
} from '../shared'
import { BoostedRoute, TradeType } from '@cryptoalgebra/integral-sdk'
import { expect } from 'chai'

describe('ERC4626 Wrap/Unwrap Tests:', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await setupTestEnvironment()
  })

  it('Wrap USDC -> Aave USDC', async () => {
    const { trader, routerSDK, contracts } = ctx
    const amountInUSDC = expandTo6DecimalsBN(100)
    const expectedAmountOutWaUSDC = BigNumber.from(await contracts.waUSDC.previewDeposit(amountInUSDC))

    const route = new BoostedRoute([], BASE_USDC, BASE_WA_USDC)
    const trade = createOmegaTrade(route, amountInUSDC, expectedAmountOutWaUSDC, TradeType.EXACT_INPUT)

    const callParameters = routerSDK.swapCallParameters(trade, {
      recipient: trader.address,
      slippageTolerance: SLIPPAGE,
      deadline: DEADLINE,
      feeOnTransfer: false,
    })

    await executeRouterCalldata(callParameters, trader, contracts.weth, contracts.dai, contracts.usdc)

    const receivedWaUSDC = await contracts.waUSDC.balanceOf(trader.address)
    expect(receivedWaUSDC).to.be.eq(expectedAmountOutWaUSDC)
  })

  it('Unwrap Aave USDC -> USDC', async () => {
    const { trader, routerSDK, contracts } = ctx
    // Obtain waUSDC for the test - deposit some USDC first
    const depositAmount = expandTo6DecimalsBN(1000)
    await contracts.usdc.connect(trader).approve(contracts.waUSDC.address, depositAmount)
    await contracts.waUSDC.connect(trader).deposit(depositAmount, trader.address)

    const amountInWaUSDC = await contracts.waUSDC.balanceOf(trader.address)
    const expectedAmountOutUSDC = BigNumber.from(await contracts.waUSDC.previewRedeem(amountInWaUSDC))

    const route = new BoostedRoute([], BASE_WA_USDC, BASE_USDC)
    const trade = createOmegaTrade(route, amountInWaUSDC, expectedAmountOutUSDC, TradeType.EXACT_INPUT)

    const callParameters = routerSDK.swapCallParameters(trade, {
      recipient: trader.address,
      slippageTolerance: SLIPPAGE,
      deadline: DEADLINE,
      feeOnTransfer: false,
    })

    const { usdcBalanceBefore, usdcBalanceAfter } = await executeRouterCalldata(
      callParameters,
      trader,
      contracts.weth,
      contracts.dai,
      contracts.usdc
    )

    // USDC received should be at least expectedAmountOutUSDC (may be slightly more due to yield accrual)
    expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.be.gte(expectedAmountOutUSDC)
  })
})
