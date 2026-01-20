import 'hardhat-typechain'
import '@nomiclabs/hardhat-ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import '@nomicfoundation/hardhat-foundry'
import dotenv from 'dotenv'
import type { HardhatUserConfig } from 'hardhat/config'

dotenv.config()

const DEFAULT_COMPILER_SETTINGS = {
  version: '0.8.26',
  settings: {
    viaIR: true,
    evmVersion: 'cancun',
    optimizer: {
      enabled: true,
      runs: 1,
    },
    metadata: {
      bytecodeHash: 'none',
    },
  },
}

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
      chainId: 8453,
      hardfork: 'cancun',
      forking: {
        url: `https://rpc.ankr.com/base/${process.env.ANKR_API_KEY}`,
        blockNumber: 41067903,
      },
      accounts: {
        mnemonic: 'your custom mnemonic phrase goes here your custom mnemonic phrase goes here',
      },
      chains: {
        8453: {
          hardforkHistory: {
            cancun: 0,
          },
        },
      },
    },
    mainnet: {
      url: `https://rpc.ankr.com/eth/${process.env.ANKR_API_KEY}`,
    },
    base: {
      url: `https://rpc.ankr.com/base/${process.env.ANKR_API_KEY}`,
    },
  },
  solidity: {
    compilers: [DEFAULT_COMPILER_SETTINGS],
  },
  mocha: {
    timeout: 60000,
  },
}

export default config
