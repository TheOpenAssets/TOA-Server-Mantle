/**
 * Utility for detecting wallet network type from address format
 */

export enum WalletNetwork {
  EVM = 'evm',
  STELLAR = 'stellar',
  UNKNOWN = 'unknown',
}

/**
 * Detects the network type based on wallet address format
 * @param walletAddress - The wallet address to check
 * @returns WalletNetwork enum value
 */
export function detectWalletNetwork(walletAddress: string): WalletNetwork {
  if (!walletAddress) {
    return WalletNetwork.UNKNOWN;
  }

  const normalized = walletAddress.trim();

  // EVM address: starts with 0x, 42 characters total (0x + 40 hex chars)
  if (normalized.startsWith('0x') && normalized.length === 42) {
    return WalletNetwork.EVM;
  }

  // Stellar address: starts with G (public key), 56 characters
  // Format: G followed by 55 base32 characters
  if (normalized.startsWith('G') && normalized.length === 56) {
    return WalletNetwork.STELLAR;
  }

  return WalletNetwork.UNKNOWN;
}

/**
 * Checks if the wallet is an EVM address
 */
export function isEvmWallet(walletAddress: string): boolean {
  return detectWalletNetwork(walletAddress) === WalletNetwork.EVM;
}

/**
 * Checks if the wallet is a Stellar address
 */
export function isStellarWallet(walletAddress: string): boolean {
  return detectWalletNetwork(walletAddress) === WalletNetwork.STELLAR;
}
