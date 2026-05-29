import { BoostedToken, Token } from '@cryptoalgebra/integral-sdk'

// Base Chain tokens
export const BASE_WETH = new Token(84532, '0x6113D55fCb7949B6d118563DAC32cB5D76009c18', 18, 'WETH', 'Wrapped Ether')
export const BASE_USDC = new Token(84532, '0xdc8eB684CA4bCD58CAFEacdBBF5A9fA628F81DF3', 18, 'USDC', 'USD//C')
export const BASE_DAI = new Token(84532, '0xdc8eB684CA4bCD58CAFEacdBBF5A9fA628F81DF3', 18, 'DAI', 'Dai Stablecoin')

// Base Chain boosted tokens
export const BASE_WM_USDC = new BoostedToken(
  84532,
  '0x6045450424c527bee1a2638d822d11bbca4f2a46',
  18,
  'smUSDC',
  'Wrapped Morpho USDC',
  BASE_USDC
)

export const BASE_WA_WETH = new BoostedToken(
  84532,
  '0xF115d73823B3268AaaA58691a3778c08DeE77A91',
  18,
  'waWETH',
  'Wrapped Aave WETH',
  BASE_WETH
)

export const BASE_WA_USDC = new BoostedToken(
  84532,
  '0x6045450424c527bee1a2638d822d11bbca4f2a46',
  18,
  'waUSDC',
  'Wrapped Aave USDC',
  BASE_USDC
)
