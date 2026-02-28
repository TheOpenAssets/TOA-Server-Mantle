import { NetworkType } from '@openassets/types';

/**
 * Detects the network type based on the wallet address format.
 * NOTE: Cannot distinguish between EVM chains (Mantle, Arbitrum) by address alone.
 * Use getConfiguredNetworkType() for accurate network detection in multi-EVM scenarios.
 */
export function detectNetworkType(address: string): NetworkType {
  if (!address) return NetworkType.UNKNOWN;

  // EVM address: starts with 0x, exactly 42 characters
  // WARNING: This returns MANTLE but could be any EVM chain (Arbitrum, etc.)
  if (address.startsWith('0x') && address.length === 42) {
    return NetworkType.MANTLE; // Generic EVM detection - use getConfiguredNetworkType() instead
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
  
  if (network === NetworkType.MANTLE || network === NetworkType.ARBITRUM) {
    return address.toLowerCase();
  }
  
  if (network === NetworkType.STELLAR) {
    return address.toUpperCase();
  }
  
  return address;
}

/**
 * Returns the configured network type from environment/config.
 * Use this instead of detectNetworkType() when you need the actual active network.
 */
export function getConfiguredNetworkType(): NetworkType {
  const configured = process.env.NETWORK_TYPE as NetworkType;
  return configured || NetworkType.MANTLE;
}
