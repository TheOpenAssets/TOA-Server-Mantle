import { registerAs } from '@nestjs/config';

export default registerAs('blockchain', () => ({
  rpcUrl: process.env.MANTLE_RPC_URL || 'https://rpc.sepolia.mantle.xyz',
  wssUrl: process.env.MANTLE_WSS_URL || 'wss://rpc.sepolia.mantle.xyz',
  chainId: parseInt(process.env.CHAIN_ID || '5003', 10), // Mantle Sepolia default
  network: process.env.BLOCKCHAIN_NETWORK || 'mantle-testnet', // Network identifier for contract loading
  evmNativeSymbol: process.env.EVM_NATIVE_SYMBOL || 'MNT', // Native currency symbol (MNT for Mantle, ETH for Arbitrum)

  // Wallets
  adminPrivateKey: process.env.ADMIN_PRIVATE_KEY,
  platformPrivateKey: process.env.PLATFORM_PRIVATE_KEY,
  custodyAddress: process.env.CUSTODY_WALLET_ADDRESS,
}));
