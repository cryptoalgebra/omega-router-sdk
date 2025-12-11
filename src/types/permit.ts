import { PermitSingle } from '@uniswap/permit2-sdk'

export interface Permit2Permit extends PermitSingle {
  signature: string
}

export type ApproveProtocol = {
  token: string
  protocol: string
}

export type Permit2TransferFrom = {
  token: string
  amount: string
  recipient?: string
}

export type InputTokenOptions = {
  permit2Permit?: Permit2Permit
  permit2TransferFrom?: Permit2TransferFrom
}
