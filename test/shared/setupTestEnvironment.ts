import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { PERMIT2_ADDRESS } from '@uniswap/permit2-sdk'
import { Contract } from 'ethers'
import { erc20Abi, erc4626Abi } from 'viem'
import { OmegaRouter } from '../../src'
import { PERMIT2_ABI, NFT_POSITION_MANAGER_ABI } from './abi'
import { INTEGRAL_NFT_POSITION_MANAGER_BASE, OMEGA_ROUTER_ADDRESS } from './addresses'
import { BASE_USDC_WHALE, BASE_DAI_WHALE, BASE_WETH_WHALE, MAX_UINT, MAX_UINT160, DEADLINE } from './constants'
import { expandTo6DecimalsBN, expandTo18DecimalsBN } from './helpers'
import { resetFork, transferFromWhale } from './mainnetForkHelpers'
import { BASE_USDC, BASE_WETH, BASE_DAI, BASE_WA_WETH, BASE_WM_USDC, BASE_WA_USDC } from './tokens'

import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
const { ethers } = hre

export interface TestContracts {
  usdc: Contract
  weth: Contract
  dai: Contract
  waWETH: Contract
  wmUSDC: Contract
  waUSDC: Contract
  permit2: Contract
  nfpm: Contract
}

export interface TestContext {
  deployer: SignerWithAddress
  trader: SignerWithAddress
  contracts: TestContracts
  routerSDK: OmegaRouter
}

/**
 * Sets up the test environment: initializes signers, contracts, and token balances
 */
export async function setupTestEnvironment(): Promise<TestContext> {
  await resetFork()
  const [deployer, trader] = await ethers.getSigners()

  // Initialize contracts
  const usdc = await ethers.getContractAt(erc20Abi, BASE_USDC.address)
  const weth = await ethers.getContractAt(erc20Abi, BASE_WETH.address)
  const dai = await ethers.getContractAt(erc20Abi, BASE_DAI.address)
  const waWETH = await ethers.getContractAt(erc4626Abi, BASE_WA_WETH.address)
  const wmUSDC = await ethers.getContractAt(erc4626Abi, BASE_WM_USDC.address)
  const waUSDC = await ethers.getContractAt(erc4626Abi, BASE_WA_USDC.address)
  const permit2 = await ethers.getContractAt(PERMIT2_ABI, PERMIT2_ADDRESS)
  const nfpm = await ethers.getContractAt(NFT_POSITION_MANAGER_ABI, INTEGRAL_NFT_POSITION_MANAGER_BASE)

  const routerSDK = new OmegaRouter(OMEGA_ROUTER_ADDRESS)

  // Fund deployer from whales
  await transferFromWhale(BASE_USDC_WHALE, usdc, deployer.address, expandTo6DecimalsBN(1_000_000))
  await transferFromWhale(BASE_DAI_WHALE, dai, deployer.address, expandTo18DecimalsBN(100_000))
  await transferFromWhale(BASE_WETH_WHALE, weth, deployer.address, expandTo18DecimalsBN(200))

  // Fund trader with tokens (deployer has USDC and WETH from whales)
  await usdc.connect(deployer).transfer(trader.address, expandTo6DecimalsBN(100_000))
  await dai.connect(deployer).transfer(trader.address, expandTo18DecimalsBN(30_000))
  await weth.connect(deployer).transfer(trader.address, expandTo18DecimalsBN(100))

  // Trader approves Permit2
  await usdc.connect(trader).approve(PERMIT2_ADDRESS, MAX_UINT)
  await weth.connect(trader).approve(PERMIT2_ADDRESS, MAX_UINT)
  await dai.connect(trader).approve(PERMIT2_ADDRESS, MAX_UINT)
  await waUSDC.connect(trader).approve(PERMIT2_ADDRESS, MAX_UINT)
  await wmUSDC.connect(trader).approve(PERMIT2_ADDRESS, MAX_UINT)

  // Trader approves Router via Permit2
  const permit2Connected = permit2.connect(trader)
  await permit2Connected.approve(BASE_USDC.address, OMEGA_ROUTER_ADDRESS, MAX_UINT160, DEADLINE)
  await permit2Connected.approve(BASE_WETH.address, OMEGA_ROUTER_ADDRESS, MAX_UINT160, DEADLINE)
  await permit2Connected.approve(BASE_DAI.address, OMEGA_ROUTER_ADDRESS, MAX_UINT160, DEADLINE)
  await permit2Connected.approve(BASE_WA_USDC.address, OMEGA_ROUTER_ADDRESS, MAX_UINT160, DEADLINE)
  await permit2Connected.approve(BASE_WM_USDC.address, OMEGA_ROUTER_ADDRESS, MAX_UINT160, DEADLINE)

  return {
    deployer,
    trader,
    contracts: { usdc, weth, waWETH, wmUSDC, waUSDC, permit2, nfpm, dai },
    routerSDK,
  }
}
