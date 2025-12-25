<p align="center">
  <a href="https://algebra.finance/"><img alt="Algebra" src="https://raw.githubusercontent.com/cryptoalgebra/Algebra/a501e2c758f0b406b60f8d9a5501f8a1f9542e57/logo.svg" width="360"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cryptoalgebra/omega-router-sdk"><img src="https://img.shields.io/npm/v/@cryptoalgebra/omega-router-sdk?color=green" alt="NPM Version"></a>
  <a href="https://github.com/cryptoalgebra/omega-router-sdk/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
</p>

<p align="center">
  A TypeScript SDK for interacting with the Omega Router contracts.<br>
  This SDK enables multi-protocol swaps across Uniswap V2, Uniswap V3, Algebra Integral, and Integral Boosted Pools with ERC4626 support.
</p>

## ✨ Features

- [Multi-protocol trade execution](src/entities/OmegaTrade.ts) — Combine V2, V3, and Integral routes in a single trade
- [Omega encoder](src/entities/OmegaEncoder.ts) — Automatic encoding for all supported protocols with wrap/unwrap handling
- [Quote calculation](src/entities/OmegaQuoter.ts) — Get quotes for any route type with batch support
- [Liquidity management](src/OmegaRouter.ts) — Mint, increase, decrease positions with boosted pool support
- [ERC4626 integration](src/utils/routerCommands.ts) — Automatic wrap/unwrap for boosted tokens
- [Permit2 support](src/types/permit.ts) — Gasless token approvals

---

## 📦 Installation

Using npm:

```bash
npm install @cryptoalgebra/omega-router-sdk
```

or yarn:

```bash
yarn add @cryptoalgebra/omega-router-sdk
```

### Peer Dependencies

The SDK requires the following peer dependencies:

```bash
yarn add @cryptoalgebra/integral-sdk @uniswap/v2-sdk @uniswap/v3-sdk @uniswap/sdk-core viem
```

---

## 🚀 Getting Started

### Getting Quotes

Use `OmegaQuoter` to calculate expected outputs:

```typescript
import { OmegaQuoter } from '@cryptoalgebra/omega-router-sdk'
import { createPublicClient, http } from 'viem'

const client = createPublicClient({
  chain: base,
  transport: http(),
})

const quoter = new OmegaQuoter(client, OMEGA_QUOTER_ADDRESS)

// Single quote
const result = await quoter.quote(route, amount, true) // true = exactInput

// Batch quotes for multiple routes
const results = await quoter.batchQuote(routes, amount, true)
```

### Creating an OmegaTrade

`OmegaTrade` is the main class for representing trades across multiple protocols:

```typescript
import { OmegaTrade } from '@cryptoalgebra/omega-router-sdk'
import {
  TradeType,
  CurrencyAmount,
  Route as IntegralRoute,
  BoostedRoute as IntegralBoostedRoute,
} from '@cryptoalgebra/integral-sdk'
import { Route as V2Route } from '@uniswap/v2-sdk'
import { Route as V3Route } from '@uniswap/v3-sdk'

// Create a trade with routes from different protocols
const trade = new OmegaTrade({
  v2Routes: [
    {
      route: v2Route,
      inputAmount: CurrencyAmount.fromRawAmount(tokenIn, '1000000'),
      outputAmount: CurrencyAmount.fromRawAmount(tokenOut, '990000'),
    },
  ],
  v3Routes: [
    {
      route: v3Route,
      inputAmount: CurrencyAmount.fromRawAmount(tokenIn, '1000000'),
      outputAmount: CurrencyAmount.fromRawAmount(tokenOut, '995000'),
    },
  ],
  integralRoutes: [
    {
      route: integralRoute,
      inputAmount: CurrencyAmount.fromRawAmount(tokenIn, '1000000'),
      outputAmount: CurrencyAmount.fromRawAmount(tokenOut, '999000'),
    },
  ],
  integralBoostedRoutes: [
    {
      route: integralBoostedRoute,
      inputAmount: CurrencyAmount.fromRawAmount(tokenIn, '1000000'),
      outputAmount: CurrencyAmount.fromRawAmount(tokenOut, '991000'),
    },
  ],
  tradeType: TradeType.EXACT_INPUT,
})
```

### Executing a Swap

Use `OmegaRouter` to generate calldata for swap execution:

```typescript
import { OmegaRouter } from '@cryptoalgebra/omega-router-sdk'
import { Percent } from '@cryptoalgebra/integral-sdk'

const router = new OmegaRouter(OMEGA_ROUTER_ADDRESS)

const { calldata, value } = router.swapCallParameters(trade, {
  slippageTolerance: new Percent(50, 10_000), // 0.5%
  recipient: userAddress,
  deadline: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
})
```

### Adding Liquidity to Boosted Pools

The SDK supports liquidity operations with automatic ERC4626 wrapping:

```typescript
import { OmegaRouter } from '@cryptoalgebra/omega-router-sdk'
import { Position, Percent } from '@cryptoalgebra/integral-sdk'

const router = new OmegaRouter(OMEGA_ROUTER_ADDRESS)

// Create position
const position = new Position({
  pool: boostedPool,
  tickLower: -887220,
  tickUpper: 887220,
  liquidity: '1000000000000000000',
})

// Generate calldata with automatic wrapping of underlying tokens
const { calldata, value } = router.addCallParameters(position, {
  recipient: userAddress,
  slippageTolerance: new Percent(50, 10_000),
  deadline: Math.floor(Date.now() / 1000) + 1800,
  token0Permit: permit0,
  token1Permit: permit1,
  // Provide underlying amounts to automatically wrap to boosted tokens
  amount0Underlying: underlyingAmount0,
  amount1Underlying: underlyingAmount1,
})
```

### Removing Liquidity with Unwrap

```typescript
const { calldata, value } = router.removeCallParameters(position, {
  tokenId: positionNFTId,
  liquidityPercentage: new Percent(100, 100), // 100% removal
  slippageTolerance: new Percent(50, 10_000),
  deadline: Math.floor(Date.now() / 1000) + 1800,
  permit: nftPermitSignature,
  recipient: userAddress,
  token0Unwrap: true, // Unwrap boosted token0 to underlying
  token1Unwrap: true, // Unwrap boosted token1 to underlying
})
```

---

## 🧪 Running Tests

Make sure you are running `node v18+`

Install dependencies and run integration tests:

```bash
yarn install
yarn test
```

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
