export interface WalletAdapter {
  getAdminAddress(): string;
  getPlatformAddress(): string;
  // Generic signing could be added here if needed by consumers
}
