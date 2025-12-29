import { expect } from 'chai'
import {
  CurrencyAmount,
  Percent,
  TradeType,
  Pool as IntegralPool,
  Route as IntegralRoute,
  Token,
  BoostedRoute as IntegralBoostedRoute,
} from '@cryptoalgebra/integral-sdk'
import { OmegaTrade, OmegaRouter } from '../src/index.js'
import { createMockIntegralPool } from './shared/helpers.js'
import { OMEGA_ROUTER_ADDRESS } from './shared/addresses.js'
import { BASE_USDC, BASE_USDT, BASE_WA_USDC, BASE_WA_WETH, BASE_WETH } from './shared/tokens.js'

describe('Integral Swap Tests', () => {
  let tokenA: Token
  let tokenB: Token
  let pool: IntegralPool
  let router: OmegaRouter

  beforeEach(() => {
    tokenA = BASE_WETH
    tokenB = BASE_USDC
    pool = createMockIntegralPool(tokenA, tokenB)
    router = new OmegaRouter(OMEGA_ROUTER_ADDRESS)
  })

  describe('OmegaTrade creation', () => {
    it('should create an OmegaTrade with Integral route (EXACT_INPUT)', () => {
      const route = new IntegralRoute([pool], tokenA, tokenB)
      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1000000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenB, '990000000000000000')

      const trade = new OmegaTrade({
        integralRoutes: [
          {
            route,
            inputAmount,
            outputAmount,
          },
        ],
        tradeType: TradeType.EXACT_INPUT,
      })

      expect(trade.tradeType).to.equal(TradeType.EXACT_INPUT)
      expect(trade.inputAmount.currency.equals(tokenA)).to.be.true
      expect(trade.outputAmount.currency.equals(tokenB)).to.be.true
      expect(trade.inputAmount.quotient.toString()).to.equal('1000000000000000000')
      expect(trade.outputAmount.quotient.toString()).to.equal('990000000000000000')
      expect(trade.routes.length).to.equal(1)
      expect(trade.swaps.length).to.equal(1)
    })

    it('should create an OmegaTrade with Integral route (EXACT_OUTPUT)', () => {
      const route = new IntegralRoute([pool], tokenA, tokenB)
      const outputAmount = CurrencyAmount.fromRawAmount(tokenB, '1000000000000000000')
      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1010000000000000000')

      const trade = new OmegaTrade({
        integralRoutes: [
          {
            route,
            inputAmount,
            outputAmount,
          },
        ],
        tradeType: TradeType.EXACT_OUTPUT,
      })

      expect(trade.tradeType).to.equal(TradeType.EXACT_OUTPUT)
      expect(trade.inputAmount.quotient.toString()).to.equal('1010000000000000000')
      expect(trade.outputAmount.quotient.toString()).to.equal('1000000000000000000')
    })

    it('should create an OmegaTrade with Integral Boosted route (EXACT_INPUT)', () => {
      const boostedTokenA = BASE_WA_WETH
      const boostedTokenB = BASE_WA_USDC
      const boostedPool = createMockIntegralPool(boostedTokenA, boostedTokenB)

      // Route 1 WETH -> waWETH -> waUSDC -> 2500 USDC
      const route = new IntegralBoostedRoute([boostedPool], tokenA, tokenB)
      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1000000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenB, '2500000000')

      const trade = new OmegaTrade({
        integralBoostedRoutes: [
          {
            route,
            inputAmount,
            outputAmount,
          },
        ],
        tradeType: TradeType.EXACT_INPUT,
      })

      // Verify trade properties
      expect(trade.tradeType).to.equal(TradeType.EXACT_INPUT)
      expect(trade.inputAmount.currency.equals(tokenA)).to.be.true
      expect(trade.outputAmount.currency.equals(tokenB)).to.be.true
      expect(trade.inputAmount.quotient.toString()).to.equal('1000000000000000000')
      expect(trade.outputAmount.quotient.toString()).to.equal('2500000000')
      expect(trade.routes.length).to.equal(1)
      expect(trade.swaps.length).to.equal(1)
    })

    it('should create an OmegaTrade with Integral Boosted route (EXACT_OUTPUT)', () => {
      const boostedTokenA = BASE_WA_WETH
      const boostedTokenB = BASE_WA_USDC
      const boostedPool = createMockIntegralPool(boostedTokenA, boostedTokenB)

      // Route 1 WETH -> waWETH -> waUSDC -> 2500 USDC
      const route = new IntegralBoostedRoute([boostedPool], tokenA, tokenB)
      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1000000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenB, '2500000000')

      const trade = new OmegaTrade({
        integralBoostedRoutes: [
          {
            route,
            inputAmount,
            outputAmount,
          },
        ],
        tradeType: TradeType.EXACT_OUTPUT,
      })

      expect(trade.tradeType).to.equal(TradeType.EXACT_OUTPUT)
      expect(trade.inputAmount.currency.equals(tokenA)).to.be.true
      expect(trade.outputAmount.currency.equals(tokenB)).to.be.true
      expect(trade.inputAmount.quotient.toString()).to.equal('1000000000000000000')
      expect(trade.outputAmount.quotient.toString()).to.equal('2500000000')
      expect(trade.routes.length).to.equal(1)
      expect(trade.swaps.length).to.equal(1)
    })
  })

  describe('OmegaRouter.swapCallParameters', () => {
    it('should generate calldata for EXACT_INPUT swap', () => {
      const route = new IntegralRoute([pool], tokenA, tokenB)
      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1000000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenB, '990000000000000000')

      const trade = new OmegaTrade({
        integralRoutes: [{ route, inputAmount, outputAmount }],
        tradeType: TradeType.EXACT_INPUT,
      })

      const recipient = '0x4444444444444444444444444444444444444444'
      const deadline = Math.floor(Date.now() / 1000) + 1800 

      const { calldata, value } = router.swapCallParameters(trade, {
        slippageTolerance: new Percent(50, 10_000), // 0.5%
        recipient,
        deadline,
        feeOnTransfer: false,
      })

      expect(calldata).to.be.a('string')
      expect((calldata as string).startsWith('0x')).to.be.true
      expect(calldata.length).to.be.greaterThan(10)
      // Value should be 0 for ERC20 -> ERC20 swap
      expect(BigInt(value.toString()).toString()).to.equal('0')
    })

    it('should generate calldata for EXACT_OUTPUT swap', () => {
      const route = new IntegralRoute([pool], tokenA, tokenB)

      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1010000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenB, '1000000000000000000')

      const trade = new OmegaTrade({
        integralRoutes: [{ route, inputAmount, outputAmount }],
        tradeType: TradeType.EXACT_OUTPUT,
      })

      const recipient = '0x4444444444444444444444444444444444444444' as `0x${string}`
      const deadline = Math.floor(Date.now() / 1000) + 1800

      const { calldata, value } = router.swapCallParameters(trade, {
        slippageTolerance: new Percent(50, 10_000),
        recipient,
        deadline,
        feeOnTransfer: false,
      })

      expect(calldata).to.be.a('string')
      expect((calldata as string).startsWith('0x')).to.be.true
      expect(calldata.length).to.be.greaterThan(10)
      expect(BigInt(value.toString()).toString()).to.equal('0')
    })
  })

  describe('Multi-hop Integral route', () => {
    it('should create trade with multi-hop route (A -> B -> C)', () => {
      const tokenC = BASE_USDT

      const poolAB = createMockIntegralPool(tokenA, tokenB)
      const poolBC = createMockIntegralPool(tokenB, tokenC)

      // multi-hop route: A -> B -> C
      const route = new IntegralRoute([poolAB, poolBC], tokenA, tokenC)

      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1000000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenC, '980000000000000000')

      const trade = new OmegaTrade({
        integralRoutes: [{ route, inputAmount, outputAmount }],
        tradeType: TradeType.EXACT_INPUT,
      })

      expect(trade.routes[0].pools.length).to.equal(2)
      expect(trade.inputAmount.currency.equals(tokenA)).to.be.true
      expect(trade.outputAmount.currency.equals(tokenC)).to.be.true
    })
    it('Boosted: Exact_input multihop', async()=>{
      const wU = BASE_WA_USDC
      const poolAwU = createMockIntegralPool(tokenA, wU)
      const poolUwB = createMockIntegralPool(wU, tokenB)
      const route = new IntegralBoostedRoute([poolAwU, poolUwB], tokenA, tokenB)
      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1000000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenB, '980000000000000000')
      const trade = new OmegaTrade({
        integralBoostedRoutes: [{ route, inputAmount, outputAmount }],
        tradeType: TradeType.EXACT_INPUT,
      })
      expect(trade.routes[0].pools.length).to.equal(2)
      expect(trade.inputAmount.currency.equals(tokenA)).to.be.true
      expect(trade.outputAmount.currency.equals(tokenB)).to.be.true
    })

    it('Boosted: Exact output multihop', async()=>{
      const wU = BASE_WA_USDC
      const poolAwU = createMockIntegralPool(tokenA, wU)
      const poolUwB = createMockIntegralPool(wU, tokenB)
      const route = new IntegralBoostedRoute([poolAwU, poolUwB], tokenA, tokenB)
      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1000000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenB, '980000000000000000')
      const trade = new OmegaTrade({
        integralBoostedRoutes: [{ route, inputAmount, outputAmount }],
        tradeType: TradeType.EXACT_OUTPUT,
      })
      expect(trade.routes[0].pools.length).to.equal(2)
      expect(trade.inputAmount.currency.equals(tokenA)).to.be.true
      expect(trade.outputAmount.currency.equals(tokenB)).to.be.true
      expect(trade.routes[0].protocol).to.equal('INTEGRAL_BOOSTED')
    })
    it('Boosted: ExactOut: A->B->wU->wB', async()=>{
      const wU = BASE_WA_USDC
      const wB = BASE_WA_WETH 

      const poolAB = createMockIntegralPool(tokenA, tokenB)
      const poolBwU = createMockIntegralPool(tokenB, wU)
      const poolwUwB = createMockIntegralPool(wU, wB)
      const route = new IntegralBoostedRoute([poolAB, poolBwU, poolwUwB], tokenA, wB)
      
      const inputAmount = CurrencyAmount.fromRawAmount(tokenA, '1010000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(wB, '980000000000000000') 
      
      const trade = new OmegaTrade({
        integralBoostedRoutes: [{ route, inputAmount, outputAmount }],
        tradeType: TradeType.EXACT_OUTPUT,
      })
      
      
      expect(trade.routes.length).to.equal(1)
      expect(trade.routes[0].pools.length).to.equal(3)
      
      
      expect(trade.inputAmount.currency.equals(tokenA)).to.be.true
      expect(trade.outputAmount.currency.equals(wB)).to.be.true
      
      
      expect(trade.routes[0].input.equals(tokenA)).to.be.true
      expect(trade.routes[0].output.equals(wB)).to.be.true
      
      
      const routePath = trade.routes[0].path
      expect(routePath.length).to.equal(4, 'Path should have 4 tokens: A->B->wU->wB')
      expect(routePath[0].equals(tokenA)).to.be.true
      expect(routePath[1].equals(tokenB)).to.be.true
      expect(routePath[2].equals(wU)).to.be.true
      expect(routePath[3].equals(wB)).to.be.true
  
      expect(trade.routes[0].protocol).to.equal('INTEGRAL_BOOSTED')
      
      
      expect(trade.outputAmount.quotient.toString()).to.equal('980000000000000000')
      expect(trade.inputAmount.quotient.toString()).to.equal('1010000000000000000')
      
      
      expect(trade.swaps.length).to.equal(1)
      expect(trade.swaps[0].inputAmount.currency.equals(tokenA)).to.be.true
      expect(trade.swaps[0].outputAmount.currency.equals(wB)).to.be.true
      
      
      const recipient = '0x1234567890123456789012345678901234567890'
      const deadline = Math.floor(Date.now() / 1000) + 3600 
      const slippageTolerance = new Percent(50, 10_000) 
      
      
      const { calldata } = router.swapCallParameters(trade, {
        slippageTolerance,
        recipient,
        deadline,
        feeOnTransfer: false,
      })
      
      expect(calldata).to.be.a('string')
      expect((calldata as string).startsWith('0x')).to.be.true
      expect(calldata.length).to.be.greaterThan(10)
      
      const maxAmountIn = trade.maximumAmountIn(slippageTolerance)
      expect(maxAmountIn.currency.equals(tokenA)).to.be.true
      expect(maxAmountIn.quotient >= inputAmount.quotient).to.be.true
      
      const minAmountOut = trade.minimumAmountOut(slippageTolerance)
      expect(minAmountOut.quotient.toString()).to.equal(outputAmount.quotient.toString())
      
      
    })
    it('Boosted: ExactOut: wU->wB->B->A', async()=>{
      const wU = BASE_WA_USDC
      const wB = BASE_WA_WETH 
      
      
      const poolwUwB = createMockIntegralPool(wU, wB)          
      const poolwBB = createMockIntegralPool(wB, tokenB)        
      const poolBA = createMockIntegralPool(tokenB, tokenA)    
      
      const route = new IntegralBoostedRoute([poolwUwB, poolwBB, poolBA], wU, tokenA)
      const inputAmount = CurrencyAmount.fromRawAmount(wU, '1000000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenA, '980000000000000000')
      const trade = new OmegaTrade({
        integralBoostedRoutes: [{ route, inputAmount, outputAmount }],
        tradeType: TradeType.EXACT_OUTPUT,
      })
      
      expect(trade.routes[0].pools.length).to.equal(3)  
      
      // Проверяем путь из 4 токенов
      const routePath = trade.routes[0].path
      expect(routePath.length).to.equal(4, 'Path should have 4 tokens: wU->wB->B->A')  
      expect(routePath[0].equals(wU)).to.be.true
      expect(routePath[1].equals(wB)).to.be.true
      expect(routePath[2].equals(tokenB)).to.be.true  
      expect(routePath[3].equals(tokenA)).to.be.true
      
      
      expect(trade.routes[0].protocol).to.equal('INTEGRAL_BOOSTED')
      expect(trade.outputAmount.quotient.toString()).to.equal('980000000000000000')
      expect(trade.inputAmount.quotient.toString()).to.equal('1000000000000000000')
  
      expect(trade.swaps.length).to.equal(1)
      expect(trade.swaps[0].inputAmount.currency.equals(wU)).to.be.true
      expect(trade.swaps[0].outputAmount.currency.equals(tokenA)).to.be.true

      const recipient = '0x1234567890123456789012345678901234567890'
      const deadline = Math.floor(Date.now() / 1000) + 3600 
      const slippageTolerance = new Percent(50, 10_000) 
      const { calldata, value } = router.swapCallParameters(trade, {
        slippageTolerance,
        recipient,
        deadline,
        feeOnTransfer: false,
      })
      expect(calldata).to.be.a('string')
      expect((calldata as string).startsWith('0x')).to.be.true
      expect(calldata.length).to.be.greaterThan(10)
      expect(BigInt(value.toString()).toString()).to.equal('0')
      
      const maxAmountIn = trade.maximumAmountIn(slippageTolerance)
      expect(maxAmountIn.currency.equals(wU)).to.be.true
      expect(maxAmountIn.quotient >= inputAmount.quotient).to.be.true
      
      const minAmountOut = trade.minimumAmountOut(slippageTolerance)
      expect(minAmountOut.quotient.toString()).to.equal(outputAmount.quotient.toString())
    });
    it('Boosted: Exact in: wU->wB->B->A', async() =>{
      const wU = BASE_WA_USDC
      const wB = BASE_WA_WETH 
      
      const poolwUwB = createMockIntegralPool(wU, wB)           
      const poolwBB = createMockIntegralPool(wB, tokenB)       
      const poolBA = createMockIntegralPool(tokenB, tokenA)    
      
      const route = new IntegralBoostedRoute([poolwUwB, poolwBB, poolBA], wU, tokenA)
      const inputAmount = CurrencyAmount.fromRawAmount(wU, '1000000000000000000')
      const outputAmount = CurrencyAmount.fromRawAmount(tokenA, '980000000000000000')
      
      const trade = new OmegaTrade({
        integralBoostedRoutes: [{ route, inputAmount, outputAmount }],
        tradeType: TradeType.EXACT_INPUT,
      })
      
      
      expect(trade.routes[0].pools.length).to.equal(3)
      
      
      const routePath = trade.routes[0].path
      expect(routePath.length).to.equal(4, 'Path should have 4 tokens: wU->wB->B->A')
      expect(routePath[0].equals(wU)).to.be.true
      expect(routePath[1].equals(wB)).to.be.true
      expect(routePath[2].equals(tokenB)).to.be.true  
      expect(routePath[3].equals(tokenA)).to.be.true
  
      expect(trade.routes[0].protocol).to.equal('INTEGRAL_BOOSTED')
      expect(trade.inputAmount.quotient.toString()).to.equal('1000000000000000000')
  
      expect(trade.swaps.length).to.equal(1)
      expect(trade.swaps[0].inputAmount.currency.equals(wU)).to.be.true
      expect(trade.swaps[0].outputAmount.currency.equals(tokenA)).to.be.true
      const recipient = '0x1234567890123456789012345678901234567890'
      const deadline = Math.floor(Date.now() / 1000) + 3600 
      const slippageTolerance = new Percent(50, 10_000) 
      const { calldata, value } = router.swapCallParameters(trade, {
        slippageTolerance,
        recipient,
        deadline,
        feeOnTransfer: false,
      })
      expect(calldata).to.be.a('string')
      expect((calldata as string).startsWith('0x')).to.be.true
      expect(calldata.length).to.be.greaterThan(10)
      expect(BigInt(value.toString()).toString()).to.equal('0')
      
      const maxAmountIn = trade.maximumAmountIn(slippageTolerance)
      expect(maxAmountIn.currency.equals(wU)).to.be.true
      expect(maxAmountIn.quotient >= inputAmount.quotient).to.be.true
      expect(Number(trade.outputAmount.quotient.toString())).to.be.gt(0)
      })
  })
})
