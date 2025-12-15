import { Currency, Price, Token } from '@uniswap/sdk-core'
import { Route as V2RouteSDK, Pair } from '@uniswap/v2-sdk'
import { Route as V3RouteSDK, Pool as V3Pool } from '@uniswap/v3-sdk'
import {
  Route as IntegralRouteSDK,
  BoostedRoute as IntegralBoostedRouteSDK,
  Pool as IntegralPool,
  Currency as IntegralCurrency,
  Price as IntegralPrice,
} from '@cryptoalgebra/integral-sdk'
import { Protocol } from '../types/protocol'

// Helper function to get the pathInput and pathOutput for a V2 / V3 route
// currency could be native so we check against the wrapped version as they don't support native ETH in path
export function getPathToken(currency: Currency, pool: Pair | V3Pool): Token {
  if (pool.token0.wrapped.equals(currency.wrapped)) {
    return pool.token0 as Token
  } else if (pool.token1.wrapped.equals(currency.wrapped)) {
    return pool.token1 as Token
  } else {
    throw new Error(`Expected token ${currency.symbol} to be either ${pool.token0.symbol} or ${pool.token1.symbol}`)
  }
}

export interface IRoute<TInput extends Currency, TOutput extends Currency, TPool extends Pair | V3Pool | IntegralPool> {
  protocol: Protocol
  // array of pools if v3 or pairs if v2
  pools: TPool[]
  path: Currency[]
  midPrice: TPool extends IntegralCurrency ? IntegralPrice<IntegralCurrency, IntegralCurrency> : Price<TInput, TOutput>
  input: TInput
  output: TOutput
}

// V2 route wrapper
export class RouteV2<TInput extends Currency, TOutput extends Currency>
  extends V2RouteSDK<TInput, TOutput>
  implements IRoute<TInput, TOutput, Pair>
{
  public readonly protocol: Protocol = Protocol.V2
  public readonly pools: Pair[]

  constructor(v2Route: V2RouteSDK<TInput, TOutput>) {
    super(v2Route.pairs, v2Route.input, v2Route.output)
    this.pools = this.pairs
  }
}

// V3 route wrapper
export class RouteV3<TInput extends Currency, TOutput extends Currency>
  extends V3RouteSDK<TInput, TOutput>
  implements IRoute<TInput, TOutput, V3Pool>
{
  public readonly protocol: Protocol = Protocol.V3
  public readonly path: Token[]

  constructor(v3Route: V3RouteSDK<TInput, TOutput>) {
    super(v3Route.pools, v3Route.input, v3Route.output)
    this.path = v3Route.tokenPath as Token[]
  }
}

// Integral route wrapper
// @ts-ignore - Price type mismatch between @cryptoalgebra/integral-sdk and @uniswap/sdk-core
export class RouteIntegral<TInput extends IntegralCurrency, TOutput extends IntegralCurrency>
  extends IntegralRouteSDK<TInput, TOutput>
  implements IRoute<TInput, TOutput, IntegralPool>
{
  public readonly protocol: Protocol = Protocol.INTEGRAL
  public readonly path: IntegralCurrency[]

  constructor(integralRoute: IntegralRouteSDK<TInput, TOutput>) {
    super(integralRoute.pools, integralRoute.input, integralRoute.output)
    this.path = integralRoute.tokenPath
  }
}

// Integral Boosted route wrapper (with ERC4626 wrap/unwrap steps)
// @ts-ignore - Price type mismatch between @cryptoalgebra/integral-sdk and @uniswap/sdk-core
export class RouteIntegralBoosted<TInput extends IntegralCurrency, TOutput extends IntegralCurrency>
  extends IntegralBoostedRouteSDK<TInput, TOutput>
  implements IRoute<TInput, TOutput, IntegralPool>
{
  public readonly protocol: Protocol = Protocol.INTEGRAL_BOOSTED
  public readonly path: IntegralCurrency[]

  constructor(boostedRoute: IntegralBoostedRouteSDK<TInput, TOutput>) {
    super(boostedRoute.pools, boostedRoute.input, boostedRoute.output)
    this.path = boostedRoute.tokenPath
  }
}
