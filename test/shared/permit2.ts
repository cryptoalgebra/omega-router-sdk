import { AnyToken } from '@cryptoalgebra/integral-sdk'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, Contract } from 'ethers'
import { DEADLINE } from './constants'
import { OMEGA_ROUTER_ADDRESS } from './addresses'

export interface PermitDetails {
  token: string
  amount: BigNumber | number
  expiration: number
  nonce: number
}

export interface PermitSingle {
  details: PermitDetails
  spender: string
  sigDeadline: number
}

const PERMIT2_DOMAIN_NAME = 'Permit2'

const PERMIT_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
}

export async function getPermitSignature(
  permit: PermitSingle,
  signer: SignerWithAddress,
  permit2: Contract
): Promise<string> {
  const chainId = await signer.getChainId()

  const domain = {
    name: PERMIT2_DOMAIN_NAME,
    chainId,
    verifyingContract: permit2.address,
  }

  return await signer._signTypedData(domain, PERMIT_TYPES, permit)
}

export async function getInputTokenPermit(
  token: AnyToken,
  amount: BigNumber,
  signer: SignerWithAddress,
  permit2: Contract
) {
  const permit = {
    details: { token: token.address, amount, expiration: 0, nonce: 0 },
    spender: OMEGA_ROUTER_ADDRESS,
    sigDeadline: DEADLINE,
  }
  return { signature: await getPermitSignature(permit, signer, permit2), ...permit }
}
