import '@nomiclabs/hardhat-ethers'
import hre from 'hardhat'
import { Contract, BigNumber } from 'ethers'
import { INTEGRAL_FACTORY_BASE, INTEGRAL_FACTORY_OWNER_BASE } from './addresses'

const { ethers } = hre

export async function resetFork(blockNumber?: number, jsonRpcUrl?: string) {
  const url = jsonRpcUrl ?? `https://rpc.ankr.com/base/${process.env.ANKR_API_KEY}`
  const block = blockNumber ?? 40120776

  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: url,
          blockNumber: block,
        },
      },
    ],
  })
}

/**
 * Disable the default plugin factory to allow pool creation without plugin issues
 * This is needed because the plugin factory on Base fork may reject pool creation
 */
export async function disablePluginFactory() {
  // Impersonate factory owner
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [INTEGRAL_FACTORY_OWNER_BASE],
  })
  await hre.network.provider.send('hardhat_setBalance', [
    INTEGRAL_FACTORY_OWNER_BASE,
    '0x56BC75E2D63100000', // 100 ETH
  ])

  const factoryOwner = await ethers.getSigner(INTEGRAL_FACTORY_OWNER_BASE)

  const factoryWithSetPlugin = new Contract(
    INTEGRAL_FACTORY_BASE,
    [
      'function setDefaultPluginFactory(address newDefaultPluginFactory) external',
      'function defaultPluginFactory() view returns (address)',
    ],
    ethers.provider
  )

  // Set plugin factory to zero to bypass plugin creation
  await factoryWithSetPlugin.connect(factoryOwner).setDefaultPluginFactory('0x0000000000000000000000000000000000000000')
  console.log('Disabled plugin factory')

  // Stop impersonating
  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [INTEGRAL_FACTORY_OWNER_BASE],
  })
}

/**
 * Impersonate a whale account and transfer tokens to recipient
 */
export async function transferFromWhale(
  whale: string,
  token: Contract,
  recipient: string,
  amount: BigNumber
): Promise<void> {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [whale],
  })
  // Give whale ETH for gas
  await hre.network.provider.send('hardhat_setBalance', [whale, '0x56BC75E2D63100000'])
  const whaleSigner = await ethers.getSigner(whale)
  await token.connect(whaleSigner).transfer(recipient, amount)
  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [whale],
  })
}
