import { defineChain } from 'viem';

/**
 * HashKey Chain Testnet (EVM-compatible)
 * Chain ID : 133
 * Docs     : https://hashfans.io
 */
export const hashkeyTestnet = defineChain({
  id: 133,
  name: 'HashKey Chain Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'HashKey',
    symbol: 'HSK',
  },
  rpcUrls: {
    default: {
      http: [process.env.HASHKEY_RPC_URL || 'https://hashkeychain-testnet.alt.technology'],
      webSocket: [process.env.HASHKEY_WSS_URL || 'wss://hashkeychain-testnet.alt.technology/ws'],
    },
    public: {
      http: [process.env.HASHKEY_RPC_URL || 'https://hashkeychain-testnet.alt.technology'],
      webSocket: [process.env.HASHKEY_WSS_URL || 'wss://hashkeychain-testnet.alt.technology/ws'],
    },
  },
  blockExplorers: {
    default: {
      name: 'HashKey Explorer',
      url: 'https://hashkey-testnet.blockscout.com',
    },
  },
  testnet: true,
});
