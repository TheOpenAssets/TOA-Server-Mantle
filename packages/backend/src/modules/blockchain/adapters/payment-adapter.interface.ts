/**
 * Payment Adapter Interface
 * 
 * Defines unified stablecoin payment operations across different blockchain networks.
 * Each network implementation (EVM/Stellar) must provide its own payment adapter
 * that handles network-specific stablecoin transfer logic.
 * 
 * Design Philosophy:
 * - Network-agnostic return types (strings, not library-specific types)
 * - Human-readable formatting for immediate use in logging/notifications
 * - Single responsibility: stablecoin payments only (USDC or equivalent)
 */

export interface PaymentTransferResult {
  txId: string; // Transaction hash/ID (network-specific format)
  blockNumber: number; // Block number (EVM) or ledger sequence (Stellar)
  amount: string; // Raw amount transferred (string BigInt for precision)
  amountFormatted: string; // Human-readable: "1000.00 USDC"
  recipient: string; // Recipient address/public key
  timestamp: number; // Unix timestamp (seconds)
  tokenSymbol: string; // e.g., "USDC"
}

export interface PaymentAdapter {
  /**
   * Transfer stablecoin from platform wallet to recipient
   * 
   * @param recipient - Destination wallet address
   * @param amount - Amount in smallest unit (e.g., 1000000 = 1 USDC with 6 decimals)
   * @returns Transaction details
   * @throws Error if insufficient balance or transaction fails
   */
  transferStablecoin(
    recipient: string,
    amount: string | bigint,
  ): Promise<PaymentTransferResult>;

  /**
   * Get platform wallet's stablecoin balance
   * 
   * @returns Balance in smallest unit (e.g., 1000000 = 1 USDC)
   */
  getPlatformStablecoinBalance(): Promise<string>;

  /**
   * Get stablecoin symbol for this network
   * 
   * @returns Token symbol (e.g., "USDC")
   */
  getStablecoinSymbol(): Promise<string>;

  /**
   * Get stablecoin identifier for this network
   * 
   * @returns EVM: Contract address (0x...), Stellar: Asset code:issuer or contract ID
   */
  getStablecoinIdentifier(): Promise<string>;

  /**
   * Get stablecoin decimals
   * 
   * @returns Number of decimals (typically 6 for USDC)
   */
  getStablecoinDecimals(): Promise<number>;
}
