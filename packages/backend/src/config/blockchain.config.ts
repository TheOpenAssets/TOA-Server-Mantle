import { registerAs } from '@nestjs/config';

export default registerAs('blockchain', () => {
  const networkType = process.env.NETWORK_TYPE || 'mantle';
  const isCreditcoin = networkType === 'creditcoin';

  // Select the correct RPC URL based on active network
  const rpcUrl = isCreditcoin
    ? (process.env.CREDITCOIN_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network/')
    : (process.env.MANTLE_RPC_URL || 'https://rpc.sepolia.mantle.xyz');
  const wssUrl = isCreditcoin
    ? (process.env.CREDITCOIN_WSS_URL || rpcUrl)
    : (process.env.MANTLE_WSS_URL || 'wss://rpc.sepolia.mantle.xyz');
  const chainId = isCreditcoin
    ? parseInt(process.env.CREDITCOIN_CHAIN_ID || '102031', 10)
    : parseInt(process.env.CHAIN_ID || '5003', 10);

  return {
    rpcUrl,
    wssUrl,
    chainId,
    network: process.env.BLOCKCHAIN_NETWORK || 'mantle-testnet',
    evmNativeSymbol: process.env.EVM_NATIVE_SYMBOL || 'MNT',

    // Wallets — prefer network-specific keys when in creditcoin mode
    adminPrivateKey: isCreditcoin
      ? (process.env.CREDITCOIN_ADMIN_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY)
      : process.env.ADMIN_PRIVATE_KEY,
    platformPrivateKey: isCreditcoin
      ? (process.env.CREDITCOIN_PLATFORM_PRIVATE_KEY || process.env.PLATFORM_PRIVATE_KEY)
      : process.env.PLATFORM_PRIVATE_KEY,
    custodyAddress: isCreditcoin
      ? (process.env.CREDITCOIN_CUSTODY_WALLET_ADDRESS || process.env.CUSTODY_WALLET_ADDRESS)
      : process.env.CUSTODY_WALLET_ADDRESS,

    // Credit Coin specific (kept for legacy access)
    creditcoin: {
      rpcUrl: process.env.CREDITCOIN_RPC_URL,
      chainId: process.env.CREDITCOIN_CHAIN_ID,
      adminPrivateKey: process.env.CREDITCOIN_ADMIN_PRIVATE_KEY,
      platformPrivateKey: process.env.CREDITCOIN_PLATFORM_PRIVATE_KEY,
      custodyAddress: process.env.CREDITCOIN_CUSTODY_WALLET_ADDRESS,
    },
  };
});
