import { defaultAbiCoder } from 'ethers/lib/utils'

/**
 * CommandTypes
 * @description Flags that modify a command's execution
 * @enum {number}
 */
export enum CommandType {
  // Masks to extract certain bits of commands
  // FLAG_ALLOW_REVERT = 0x80,
  // COMMAND_TYPE_MASK = 0x3f,

  // Command Types. Maximum supported command at this moment is 0x3f.
  // The commands are executed in nested if blocks to minimise gas consumption

  // Command Types where value<=0x07, executed in the first nested-if block
  INTEGRAL_SWAP_EXACT_IN = 0x00,
  INTEGRAL_SWAP_EXACT_OUT = 0x01,
  PERMIT2_TRANSFER_FROM = 0x02,
  PERMIT2_PERMIT_BATCH = 0x03,
  SWEEP = 0x04,
  TRANSFER = 0x05,
  PAY_PORTION = 0x06,
  ERC4626_WRAP = 0x07,

  // Command Types where 0x08<=value<=0x0f, executed in the second nested-if block
  V2_SWAP_EXACT_IN = 0x08,
  V2_SWAP_EXACT_OUT = 0x09,
  PERMIT2_PERMIT = 0x0a,
  WRAP_ETH = 0x0b,
  UNWRAP_WETH = 0x0c,
  PERMIT2_TRANSFER_FROM_BATCH = 0x0d,
  BALANCE_CHECK_ERC20 = 0x0e,
  ERC4626_UNWRAP = 0x0f,

  // Command Types where 0x10<=value<=0x20, executed in the third nested-if block
  UNISWAP_V3_SWAP_EXACT_IN = 0x10,
  UNISWAP_V3_SWAP_EXACT_OUT = 0x11,
  INTEGRAL_POSITION_MANAGER_CALL = 0x12,
  INTEGRAL_MINT = 0x13,
  INTEGRAL_POSITION_MANAGER_PERMIT = 0x14,
  // COMMAND_PLACEHOLDER = 0x15 -> 0x20

  // Command Types where 0x21<=value<=0x3f
  EXECUTE_SUB_PLAN = 0x21,
  // COMMAND_PLACEHOLDER for 0x22 to 0x3f
}

export enum Subparser {
  V3PathExactIn,
  V3PathExactOut,
}

export enum Parser {
  Abi,
  IntegralActions,
  V3Actions,
}

export type ParamType = {
  readonly name: string
  readonly type: string
  readonly subparser?: Subparser
}

export type CommandDefinition =
  | {
      parser: Parser.Abi
      params: ParamType[]
    }
  | {
      parser: Parser.IntegralActions
    }
  | {
      parser: Parser.V3Actions
    }

const ALLOW_REVERT_FLAG = 0x80
const REVERTIBLE_COMMANDS = new Set<CommandType>([CommandType.EXECUTE_SUB_PLAN])

const PERMIT_STRUCT =
  '((address token,uint160 amount,uint48 expiration,uint48 nonce) details,address spender,uint256 sigDeadline)'

const PERMIT_BATCH_STRUCT =
  '((address token,uint160 amount,uint48 expiration,uint48 nonce)[] details,address spender,uint256 sigDeadline)'

const MINT_PARAMS =
  '(address token0,address token1,address deployer,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)'

const PERMIT2_TRANSFER_FROM_STRUCT = '(address from,address to,uint160 amount,address token)'
const PERMIT2_TRANSFER_FROM_BATCH_STRUCT = PERMIT2_TRANSFER_FROM_STRUCT + '[]'

export const COMMAND_DEFINITION: { [key in CommandType]: CommandDefinition } = {
  // Batch Reverts
  [CommandType.EXECUTE_SUB_PLAN]: {
    parser: Parser.Abi,
    params: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
    ],
  },

  // Permit2 Actions
  [CommandType.PERMIT2_PERMIT]: {
    parser: Parser.Abi,
    params: [
      { name: 'permit', type: PERMIT_STRUCT },
      { name: 'signature', type: 'bytes' },
    ],
  },
  [CommandType.PERMIT2_PERMIT_BATCH]: {
    parser: Parser.Abi,
    params: [
      { name: 'permit', type: PERMIT_BATCH_STRUCT },
      { name: 'signature', type: 'bytes' },
    ],
  },
  [CommandType.PERMIT2_TRANSFER_FROM]: {
    parser: Parser.Abi,
    params: [
      { name: 'token', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint160' },
    ],
  },
  [CommandType.PERMIT2_TRANSFER_FROM_BATCH]: {
    parser: Parser.Abi,
    params: [
      {
        name: 'transferFrom',
        type: PERMIT2_TRANSFER_FROM_BATCH_STRUCT,
      },
    ],
  },

  // Uniswap Actions
  [CommandType.UNISWAP_V3_SWAP_EXACT_IN]: {
    parser: Parser.Abi,
    params: [
      { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', subparser: Subparser.V3PathExactIn, type: 'bytes' },
      { name: 'payerIsUser', type: 'bool' },
    ],
  },
  [CommandType.UNISWAP_V3_SWAP_EXACT_OUT]: {
    parser: Parser.Abi,
    params: [
      { name: 'recipient', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'amountInMax', type: 'uint256' },
      { name: 'path', subparser: Subparser.V3PathExactOut, type: 'bytes' },
      { name: 'payerIsUser', type: 'bool' },
    ],
  },
  [CommandType.V2_SWAP_EXACT_IN]: {
    parser: Parser.Abi,
    params: [
      { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'payerIsUser', type: 'bool' },
    ],
  },
  [CommandType.V2_SWAP_EXACT_OUT]: {
    parser: Parser.Abi,
    params: [
      { name: 'recipient', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'amountInMax', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'payerIsUser', type: 'bool' },
    ],
  },
  // [CommandType.V4_SWAP]: { parser: Parser.V4Actions },

  // Token Actions and Checks
  [CommandType.WRAP_ETH]: {
    parser: Parser.Abi,
    params: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },
  [CommandType.UNWRAP_WETH]: {
    parser: Parser.Abi,
    params: [
      { name: 'recipient', type: 'address' },
      { name: 'amountMin', type: 'uint256' },
    ],
  },
  [CommandType.SWEEP]: {
    parser: Parser.Abi,
    params: [
      { name: 'token', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amountMin', type: 'uint256' },
    ],
  },
  [CommandType.TRANSFER]: {
    parser: Parser.Abi,
    params: [
      { name: 'token', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
  },
  [CommandType.PAY_PORTION]: {
    parser: Parser.Abi,
    params: [
      { name: 'token', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'bips', type: 'uint256' },
    ],
  },
  [CommandType.BALANCE_CHECK_ERC20]: {
    parser: Parser.Abi,
    params: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'minBalance', type: 'uint256' },
    ],
  },
  // [CommandType.V4_INITIALIZE_POOL]: {
  //   parser: Parser.Abi,
  //   params: [
  //     { name: 'poolKey', type: POOL_KEY_STRUCT },
  //     { name: 'sqrtPriceX96', type: 'uint160' },
  //   ],
  // },

  // INTEGRAL Swaps
  [CommandType.INTEGRAL_SWAP_EXACT_IN]: {
    parser: Parser.Abi,
    params: [
      { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'bytes' },
      { name: 'payerIsUser', type: 'bool' },
    ],
  },
  [CommandType.INTEGRAL_SWAP_EXACT_OUT]: {
    parser: Parser.Abi,
    params: [
      { name: 'recipient', type: 'address' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'amountInMax', type: 'uint256' },
      { name: 'path', type: 'bytes' },
      { name: 'payerIsUser', type: 'bool' },
    ],
  },

  // ERC4626 Actions
  [CommandType.ERC4626_WRAP]: {
    parser: Parser.Abi,
    params: [
      { name: 'vault', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'minSharesOut', type: 'uint256' },
    ],
  },
  [CommandType.ERC4626_UNWRAP]: {
    parser: Parser.Abi,
    params: [
      { name: 'vault', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'shares', type: 'uint256' },
      { name: 'amountMin', type: 'uint256' },
    ],
  },

  // INTEGRAL Position Actions
  [CommandType.INTEGRAL_MINT]: {
    parser: Parser.Abi,
    params: [{ name: 'params', type: MINT_PARAMS }],
  },
  [CommandType.INTEGRAL_POSITION_MANAGER_PERMIT]: { parser: Parser.IntegralActions },
  [CommandType.INTEGRAL_POSITION_MANAGER_CALL]: { parser: Parser.IntegralActions },
}

export class RoutePlanner {
  commands: string
  inputs: string[]

  constructor() {
    this.commands = '0x'
    this.inputs = []
  }

  addSubPlan(subplan: RoutePlanner): RoutePlanner {
    this.addCommand(CommandType.EXECUTE_SUB_PLAN, [subplan.commands, subplan.inputs], true)
    return this
  }

  addCommand(type: CommandType, parameters: any[], allowRevert = false): RoutePlanner {
    let command = createCommand(type, parameters)
    this.inputs.push(command.encodedInput)
    if (allowRevert) {
      if (!REVERTIBLE_COMMANDS.has(command.type)) {
        throw new Error(`command type: ${command.type} cannot be allowed to revert`)
      }
      command.type = command.type | ALLOW_REVERT_FLAG
    }

    this.commands = this.commands.concat(command.type.toString(16).padStart(2, '0'))
    return this
  }
}

export type RouterCommand = {
  type: CommandType
  encodedInput: string
}

export function createCommand(type: CommandType, parameters: any[]): RouterCommand {
  const commandDef = COMMAND_DEFINITION[type]
  switch (commandDef.parser) {
    case Parser.Abi:
      const encodedInput = defaultAbiCoder.encode(
        commandDef.params.map((abi) => abi.type),
        parameters
      )
      return { type, encodedInput }
    case Parser.IntegralActions:
      // v4 swap data comes pre-encoded at index 0
      return { type, encodedInput: parameters[0] }
    case Parser.V3Actions:
      // v4 swap data comes pre-encoded at index 0
      return { type, encodedInput: parameters[0] }
  }
}
