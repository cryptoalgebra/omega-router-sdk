import { Address, Hex } from 'viem'
import { omegaQuoterAbi } from '../abis'

/**
 * Quote result tuple format compatible with useQuotesResults
 * [amountsOut, amountsIn, sqrtPrices, ticksCrossed, gasEstimate, fees]
 */
export type QuoteResult = [bigint[], bigint[], bigint[], number[], bigint, number[]]

/**
 * Single quote output from quoter
 */
export interface QuoteOutput {
  amount: bigint
  sqrtPrices: bigint[]
  gasEstimate: bigint
}

/**
 * Built commands ready for quoter execution
 */
export interface QuoterCommands {
  commands: Hex
  inputs: Hex[]
}

/**
 * Multicall contract result
 */
export interface MulticallResult<T> {
  status: 'success' | 'failure'
  result?: T
  error?: Error
}

export interface SimulateContractResult {
  result: readonly Hex[]
}

export interface QuoterContractCall {
  address: Address
  abi: typeof omegaQuoterAbi
  functionName: 'execute'
  args: readonly [Hex, readonly Hex[]]
}
