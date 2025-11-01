export const omegaRouterAbi = [
  {
    inputs: [
      {
        components: [
          {
            internalType: 'address',
            name: 'permit2',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'weth',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'uniswapV2Factory',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'uniswapV3Factory',
            type: 'address',
          },
          {
            internalType: 'bytes32',
            name: 'uniswapPairInitCodeHash',
            type: 'bytes32',
          },
          {
            internalType: 'bytes32',
            name: 'uniswapPoolInitCodeHash',
            type: 'bytes32',
          },
          {
            internalType: 'address',
            name: 'integralFactory',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'integralPoolDeployer',
            type: 'address',
          },
          {
            internalType: 'address',
            name: 'integralPosManager',
            type: 'address',
          },
          {
            internalType: 'bytes32',
            name: 'integralPoolInitCodeHash',
            type: 'bytes32',
          },
        ],
        internalType: 'struct RouterParameters',
        name: 'params',
        type: 'tuple',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'target',
        type: 'address',
      },
    ],
    name: 'AddressEmptyCode',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'account',
        type: 'address',
      },
    ],
    name: 'AddressInsufficientBalance',
    type: 'error',
  },
  {
    inputs: [],
    name: 'BalanceTooLow',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ContractLocked',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ERC4626TooLittleReceived',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ETHNotAccepted',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'commandIndex',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'message',
        type: 'bytes',
      },
    ],
    name: 'ExecutionFailed',
    type: 'error',
  },
  {
    inputs: [],
    name: 'FailedInnerCall',
    type: 'error',
  },
  {
    inputs: [],
    name: 'FromAddressIsNotOwner',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InsufficientETH',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InsufficientToken',
    type: 'error',
  },
  {
    inputs: [],
    name: 'IntegralInvalidAmountOut',
    type: 'error',
  },
  {
    inputs: [],
    name: 'IntegralInvalidCaller',
    type: 'error',
  },
  {
    inputs: [],
    name: 'IntegralInvalidSwap',
    type: 'error',
  },
  {
    inputs: [],
    name: 'IntegralPathError',
    type: 'error',
  },
  {
    inputs: [],
    name: 'IntegralTooLittleReceived',
    type: 'error',
  },
  {
    inputs: [],
    name: 'IntegralTooMuchRequested',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'bytes4',
        name: 'action',
        type: 'bytes4',
      },
    ],
    name: 'InvalidAction',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidBips',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'commandType',
        type: 'uint256',
      },
    ],
    name: 'InvalidCommandType',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidEthSender',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidPath',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidReserves',
    type: 'error',
  },
  {
    inputs: [],
    name: 'LengthMismatch',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 'tokenId',
        type: 'uint256',
      },
    ],
    name: 'NotAuthorizedForToken',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
    ],
    name: 'SafeERC20FailedOperation',
    type: 'error',
  },
  {
    inputs: [],
    name: 'SliceOutOfBounds',
    type: 'error',
  },
  {
    inputs: [],
    name: 'TransactionDeadlinePassed',
    type: 'error',
  },
  {
    inputs: [],
    name: 'UnsafeCast',
    type: 'error',
  },
  {
    inputs: [],
    name: 'V2InvalidPath',
    type: 'error',
  },
  {
    inputs: [],
    name: 'V2TooLittleReceived',
    type: 'error',
  },
  {
    inputs: [],
    name: 'V2TooMuchRequested',
    type: 'error',
  },
  {
    inputs: [],
    name: 'V3InvalidAmountOut',
    type: 'error',
  },
  {
    inputs: [],
    name: 'V3InvalidCaller',
    type: 'error',
  },
  {
    inputs: [],
    name: 'V3InvalidSwap',
    type: 'error',
  },
  {
    inputs: [],
    name: 'V3PathError',
    type: 'error',
  },
  {
    inputs: [],
    name: 'V3TooLittleReceived',
    type: 'error',
  },
  {
    inputs: [],
    name: 'V3TooMuchRequested',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'int256',
        name: 'amount0Delta',
        type: 'int256',
      },
      {
        internalType: 'int256',
        name: 'amount1Delta',
        type: 'int256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
    ],
    name: 'algebraSwapCallback',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: 'commands',
        type: 'bytes',
      },
      {
        internalType: 'bytes[]',
        name: 'inputs',
        type: 'bytes[]',
      },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes',
        name: 'commands',
        type: 'bytes',
      },
      {
        internalType: 'bytes[]',
        name: 'inputs',
        type: 'bytes[]',
      },
      {
        internalType: 'uint256',
        name: 'deadline',
        type: 'uint256',
      },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'msgSender',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'int256',
        name: 'amount0Delta',
        type: 'int256',
      },
      {
        internalType: 'int256',
        name: 'amount1Delta',
        type: 'int256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
    ],
    name: 'uniswapV3SwapCallback',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    stateMutability: 'payable',
    type: 'receive',
  },
] as const
