export enum NetworkType {
  MANTLE = 'mantle',
  STELLAR = 'stellar',
  UNKNOWN = 'unknown',
}

/**
 * Detects the network type based on the wallet address format.
 */
export function detectNetworkType(address: string): NetworkType {
  if (!address) return NetworkType.UNKNOWN;

  // EVM address: starts with 0x, exactly 42 characters
  if (address.startsWith('0x') && address.length === 42) {
    return NetworkType.MANTLE;
  }

  // Stellar address: starts with G, exactly 56 characters
  if (address.startsWith('G') && address.length === 56) {
    return NetworkType.STELLAR;
  }
  
  // Also check if it's a lowercased stellar address that needs normalization
  if (address.startsWith('g') && address.length === 56) {
    return NetworkType.STELLAR;
  }

  return NetworkType.UNKNOWN;
}

/**
 * Normalizes a wallet address to its canonical form.
 * EVM -> lowercase
 * Stellar -> uppercase
 */
export function normalizeAddress(address: string): string {
  const network = detectNetworkType(address);
  
  if (network === NetworkType.MANTLE) {
    return address.toLowerCase();
  }
  
  if (network === NetworkType.STELLAR) {
    return address.toUpperCase();
  }
  
  return address;
}
