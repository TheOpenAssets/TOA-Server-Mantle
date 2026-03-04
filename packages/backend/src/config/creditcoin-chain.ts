import { defineChain } from 'viem';

export const creditcoinTestnet = defineChain({
  id: 102031,
  name: 'Creditcoin Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Creditcoin',
    symbol: 'CTC',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.cc3-testnet.creditcoin.network'],
      webSocket: ['wss://rpc.cc3-testnet.creditcoin.network'],
    },
    public: {
      http: ['https://rpc.cc3-testnet.creditcoin.network'],
      webSocket: ['wss://rpc.cc3-testnet.creditcoin.network'],
    },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://creditcoin-testnet.blockscout.com' },
  },
});
