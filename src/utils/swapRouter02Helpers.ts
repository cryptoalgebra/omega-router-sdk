export const DEFAULT_POOL_DEPLOYER: string = '0x0000000000000000000000000000000000000000'

export function encodePathIntegral(path: string[]): string {
  let encoded = '0x'
  for (let i = 0; i < path.length - 1; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
    // 3 byte encoding of the fee
    encoded += DEFAULT_POOL_DEPLOYER.slice(2)
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2)

  return encoded.toLowerCase()
}

export function encodePathExactInputIntegral(tokens: string[]): string {
  return encodePathIntegral(tokens)
}

export function encodePathExactOutputIntegral(tokens: string[]): string {
  return encodePathIntegral(tokens.slice().reverse())
}
