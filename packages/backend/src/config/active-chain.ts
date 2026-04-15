import { Chain } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { creditcoinTestnet } from '@/src/config/creditcoin-chain';
import { mantleSepolia } from '@/src/config/mantle-chain';
import { hashkeyTestnet } from '@/src/config/hashkey-chain';

/**
 * Returns the active viem Chain object based on the NETWORK_TYPE environment variable.
 *
 * Supported values:
 *  - 'creditcoin'  → Creditcoin Testnet (CC3)
 *  - 'hashkey'     → HashKey Chain Testnet
 *  - 'arbitrum'    → Arbitrum Sepolia
 *  - anything else (default/mantle) → Mantle Sepolia
 */
export function getActiveChain(): Chain {
  const networkType = process.env.NETWORK_TYPE;

  if (networkType === 'creditcoin') {
    return creditcoinTestnet;
  }

  if (networkType === 'arbitrum') {
    return arbitrumSepolia;
  }

  if (networkType === 'hashkey') {
    return hashkeyTestnet;
  }

  return mantleSepolia;
}
