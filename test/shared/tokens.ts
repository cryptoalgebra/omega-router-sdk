import { BoostedToken, Token } from '@cryptoalgebra/integral-sdk'

export const BASE_WETH = new Token(8453, '0x4200000000000000000000000000000000000006', 18, 'WETH', 'Wrapped Ether')
export const BASE_USDC = new Token(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'USDC', 'USD//C')
export const BASE_USDT = new Token(8453, '0x0000000000000000000000000000000000000000', 6, 'USDT', 'Tether USD')
export const BASE_DAI = new Token(8453, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 18, 'DAI', 'Dai Stablecoin')

export const BASE_WM_USDC = new BoostedToken(
  8453,
  '0x616a4E1db48e22028f6bbf20444Cd3b8e3273738',
  18,
  'smUSDC',
  'Wrapped Morpho USDC',
  BASE_USDC
)
export const BASE_WA_WETH = new BoostedToken(
  8453,
  '0xe298b938631f750DD409fB18227C4a23dCdaab9b',
  18,
  'waWETH',
  'Wrapped Aave WETH',
  BASE_WETH
)

export const BASE_WA_USDC = new BoostedToken(
  8453,
  '0xc768c589647798a6ee01a91fde98ef2ed046dbd6',
  6,
  'waUSDC',
  'Wrapped Aave USDC',
  BASE_USDC
)

export const BASE_SPARK_USDC = new BoostedToken(
  8453,
  '0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A',
  18,
  'spUSDC',
  'Spark USDC',
  BASE_USDC
)
