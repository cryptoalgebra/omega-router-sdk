import {
  Currency,
  CurrencyAmount,
  Pool as IntegralPool,
  Route as IntegralRoute,
  Token,
  Trade,
  TradeType,
} from '@cryptoalgebra/integral-sdk'
import { BigNumber } from 'ethers'
import { ETH_ADDRESS, E_ETH_ADDRESS } from './constants'

export type TokenInRoute = {
  address: string
  chainId: number
  symbol: string
  decimals: string
  name?: string
  buyFeeBps?: string
  sellFeeBps?: string
}

export enum PoolType {
  IntegralPool = 'integral-pool',
}

export type IntegralPoolInRoute = {
  type: PoolType.IntegralPool
  address?: string
  tokenIn: TokenInRoute
  tokenOut: TokenInRoute
  fee: string
  tickSpacing: string
  deployer: string
  liquidity: string
  sqrtRatioX96: string
  tickCurrent: string
  amountIn?: string
  amountOut?: string
}

export type PartialClassicQuote = {
  // We need tokenIn/Out to support native currency
  tokenIn: string
  tokenOut: string
  tradeType: TradeType
  // route теперь может содержать IntegralPoolInRoute вместо V4PoolInRoute
  route: Array<IntegralPoolInRoute[]>
}

interface RouteResult {
  routeIntegral: IntegralRoute<Currency, Currency> | null
  inputAmount: CurrencyAmount<Currency>
  outputAmount: CurrencyAmount<Currency>
}

export const isNativeCurrency = (address: string) =>
  address.toLowerCase() === ETH_ADDRESS.toLowerCase() || address.toLowerCase() === E_ETH_ADDRESS.toLowerCase()

// Helper class to convert routing-specific quote entities to RouterTrade entities
// the returned RouterTrade can then be used to build the UniswapTrade entity in this package
export class RouterTradeAdapter {
  // Generate a RouterTrade using fields from a classic quote response
  static fromClassicQuote(quote: PartialClassicQuote) {
    const { route, tokenIn, tokenOut } = quote

    if (!route) throw new Error('Expected route to be present')
    if (!route.length) throw new Error('Expected there to be at least one route')
    if (route.some((r) => !r.length)) throw new Error('Expected all routes to have at least one pool')
    const firstRoute = route[0]

    const tokenInData = firstRoute[0].tokenIn
    const tokenOutData = firstRoute[firstRoute.length - 1].tokenOut

    if (!tokenInData || !tokenOutData) throw new Error('Expected both tokenIn and tokenOut to be present')
    if (tokenInData.chainId !== tokenOutData.chainId)
      throw new Error('Expected tokenIn and tokenOut to be have same chainId')

    const parsedCurrencyIn = RouterTradeAdapter.toCurrency(isNativeCurrency(tokenIn), tokenInData)
    const parsedCurrencyOut = RouterTradeAdapter.toCurrency(isNativeCurrency(tokenOut), tokenOutData)

    const typedRoutes: RouteResult[] = route.map((subRoute) => {
      const rawAmountIn = subRoute[0].amountIn
      const rawAmountOut = subRoute[subRoute.length - 1].amountOut

      if (!rawAmountIn || !rawAmountOut) {
        throw new Error('Expected both raw amountIn and raw amountOut to be present')
      }

      const inputAmount = CurrencyAmount.fromRawAmount(parsedCurrencyIn, rawAmountIn)
      const outputAmount = CurrencyAmount.fromRawAmount(parsedCurrencyOut, rawAmountOut)

      return {
        routeIntegral: new IntegralRoute(
          subRoute.map(RouterTradeAdapter.toIntegralPool),
          parsedCurrencyIn,
          parsedCurrencyOut
        ),
        inputAmount,
        outputAmount,
      }
    })

    if (typedRoutes.length === 0) {
      throw new Error('No valid routes found')
    }

    return Trade.createUncheckedTrade({
      route: typedRoutes[0].routeIntegral as IntegralRoute<Currency, Currency>,
      inputAmount: typedRoutes[0].inputAmount,
      outputAmount: typedRoutes[0].outputAmount,
      tradeType: quote.tradeType,
    })
  }

  private static toCurrency(isNative: boolean, token: TokenInRoute): Currency {
    if (isNative) {
      return Ether.onChain(token.chainId)
    }
    return this.toToken(token)
  }

  private static toToken(token: TokenInRoute): Token {
    const { chainId, address, decimals, symbol, buyFeeBps, sellFeeBps } = token
    return new Token(
      chainId,
      address,
      parseInt(decimals.toString()),
      symbol,
      /* name */ undefined,
      false,
      buyFeeBps ? BigNumber.from(buyFeeBps) : undefined,
      sellFeeBps ? BigNumber.from(sellFeeBps) : undefined
    )
  }

  private static toIntegralPool(pool: IntegralPoolInRoute): IntegralPool {
    const parsedCurrencyIn = RouterTradeAdapter.toToken(pool.tokenIn)
    const parsedCurrencyOut = RouterTradeAdapter.toToken(pool.tokenOut)
    return new IntegralPool(
      parsedCurrencyIn,
      parsedCurrencyOut,
      parseInt(pool.fee),
      pool.sqrtRatioX96,
      pool.deployer,
      pool.liquidity,
      Number(pool.tickCurrent),
      Number(pool.tickSpacing)
    )
  }
}
