import { registerAs } from '@nestjs/config';

export default registerAs('blockchain', () => {
  const networkType = process.env.NETWORK_TYPE || 'mantle';
  const isBnb = networkType === 'bnb';
  const isArbitrum = networkType === 'arbitrum';
  const isCreditcoin = networkType === 'creditcoin';

  // Select the correct RPC URL based on active network
  const rpcUrl = isCreditcoin
    ? (process.env.CREDITCOIN_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network/')
    : isBnb
      ? (process.env.BNB_RPC_URL || process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545')
      : isArbitrum
        ? (process.env.ARBITRUM_RPC_URL || process.env.ARB_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc')
        : (process.env.MANTLE_RPC_URL || 'https://rpc.sepolia.mantle.xyz');

  const wssUrl = isCreditcoin
    ? (process.env.CREDITCOIN_WSS_URL || rpcUrl)
    : isBnb
      ? (process.env.BNB_WSS_URL || rpcUrl)
      : isArbitrum
        ? (process.env.ARBITRUM_WSS_URL || rpcUrl)
        : (process.env.MANTLE_WSS_URL || 'wss://rpc.sepolia.mantle.xyz');

  const chainId = isCreditcoin
    ? parseInt(process.env.CREDITCOIN_CHAIN_ID || '102031', 10)
    : isBnb
      ? parseInt(process.env.BNB_CHAIN_ID || '97', 10)
      : isArbitrum
        ? parseInt(process.env.ARBITRUM_CHAIN_ID || '421614', 10)
        : parseInt(process.env.CHAIN_ID || '5003', 10);

  const evmNativeSymbol = isCreditcoin
    ? 'CTC'
    : isBnb
      ? 'tBNB'
      : isArbitrum
        ? 'ETH'
        : (process.env.EVM_NATIVE_SYMBOL || 'MNT');

  return {
    rpcUrl,
    wssUrl,
    chainId,
    network: process.env.BLOCKCHAIN_NETWORK || 'mantle-testnet',
    evmNativeSymbol,

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
