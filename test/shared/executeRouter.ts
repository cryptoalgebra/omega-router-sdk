import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Contract, BigNumber } from 'ethers'
import { parseEvents, ALGEBRA_INTEGRAL_EVENTS, UNISWAP_V3_EVENTS, V2_EVENTS } from './parseEvents'
import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import { MethodParameters } from '@cryptoalgebra/integral-sdk'
import { OMEGA_ROUTER_ADDRESS } from './addresses'

const { ethers } = hre

type V2SwapEventArgs = {
  amount0In: BigNumber
  amount0Out: BigNumber
  amount1In: BigNumber
  amount1Out: BigNumber
}

type V3SwapEventArgs = {
  amount0: BigNumber
  amount1: BigNumber
}

export type ExecutionParams = {
  wethBalanceBefore: BigNumber
  wethBalanceAfter: BigNumber
  daiBalanceBefore: BigNumber
  daiBalanceAfter: BigNumber
  usdcBalanceBefore: BigNumber
  usdcBalanceAfter: BigNumber
  ethBalanceBefore: BigNumber
  ethBalanceAfter: BigNumber
  v2SwapEventArgs: V2SwapEventArgs | undefined
  v3SwapEventArgs: V3SwapEventArgs | undefined
  receipt: TransactionReceipt
  gasSpent: BigNumber
}

export enum DEX {
  UNI_V3,
  ALGEBRA_INTEGRAL,
}

export async function executeRouterCalldata(
  callParameters: MethodParameters,
  caller: SignerWithAddress,
  wethContract: Contract,
  daiContract: Contract,
  usdcContract: Contract,
  dex?: DEX
): Promise<ExecutionParams> {
  const ethBalanceBefore: BigNumber = await ethers.provider.getBalance(caller.address)
  const wethBalanceBefore: BigNumber = await wethContract.balanceOf(caller.address)
  const daiBalanceBefore: BigNumber = await daiContract.balanceOf(caller.address)
  const usdcBalanceBefore: BigNumber = await usdcContract.balanceOf(caller.address)

  const { calldata, value } = callParameters
  const txData = Array.isArray(calldata) ? ethers.utils.hexConcat(calldata) : calldata

  const receipt = await (
    await caller.sendTransaction({
      to: OMEGA_ROUTER_ADDRESS,
      data: txData,
      value: value ? BigNumber.from(value) : BigNumber.from(0),
    })
  ).wait()
  const gasSpent = receipt.gasUsed.mul(receipt.effectiveGasPrice)

  const v3SwapEventArgs = (() => {
    switch (dex) {
      case DEX.ALGEBRA_INTEGRAL:
        return parseEvents(ALGEBRA_INTEGRAL_EVENTS, receipt)[0]?.args as unknown as V3SwapEventArgs
      default:
        return parseEvents(UNISWAP_V3_EVENTS, receipt)[0]?.args as unknown as V3SwapEventArgs
    }
  })()
  const v2SwapEventArgs = parseEvents(V2_EVENTS, receipt)[0]?.args as unknown as V2SwapEventArgs

  const ethBalanceAfter: BigNumber = await ethers.provider.getBalance(caller.address)
  const wethBalanceAfter: BigNumber = await wethContract.balanceOf(caller.address)
  const daiBalanceAfter: BigNumber = await daiContract.balanceOf(caller.address)
  const usdcBalanceAfter: BigNumber = await usdcContract.balanceOf(caller.address)

  return {
    wethBalanceBefore,
    wethBalanceAfter,
    daiBalanceBefore,
    daiBalanceAfter,
    usdcBalanceBefore,
    usdcBalanceAfter,
    ethBalanceBefore,
    ethBalanceAfter,
    v3SwapEventArgs,
    v2SwapEventArgs,
    receipt,
    gasSpent,
  }
}
