import { Currency, CurrencyAmount, Percent, SwapOptions as RouterSwapOptions } from '@cryptoalgebra/integral-sdk'
import { BigNumberish } from 'ethers'
import { Address } from 'viem'
import { Permit2Permit } from './permit'
import { NFTPermitSignature } from '../utils'

export type OmegaRouterConfig = {
  sender?: string // address
  deadline?: BigNumberish
}

// the existing router permit object doesn't include enough data for permit2
// so we extend swap options with the permit2 permit
export type OmegaSwapOptions = Omit<RouterSwapOptions, 'inputTokenPermit'> & {
  inputTokenPermit?: Permit2Permit
}

export interface OmegaMintOptions {
  recipient: Address // Required for both mint and increase (for refunds)
  slippageTolerance: Percent
  deadline: BigNumberish
  useNative?: boolean
  deployer?: Address
  token0Permit: Permit2Permit | null
  token1Permit: Permit2Permit | null
  // Underlying amounts to wrap. If provided, will wrap underlying → boosted before mint
  amount0Underlying?: CurrencyAmount<Currency>
  amount1Underlying?: CurrencyAmount<Currency>
  // If tokenId is provided, will increase liquidity instead of minting new position
  tokenId?: BigNumberish
}

export interface OmegaRemoveLiquidityOptions {
  tokenId: BigNumberish
  liquidityPercentage: Percent
  slippageTolerance: Percent
  deadline: BigNumberish
  burnToken?: boolean
  permit: NFTPermitSignature
  recipient: Address // Where to send the removed liquidity
  token0Unwrap?: boolean // unwrap token0 boosted → underlying
  token1Unwrap?: boolean // unwrap token1 boosted → underlying
}

export interface OmegaCollectOptions {
  tokenId: BigNumberish
  recipient: Address
  permit: NFTPermitSignature
  token0Unwrap?: boolean // unwrap token0 boosted → underlying
  token1Unwrap?: boolean // unwrap token1 boosted → underlying
}
