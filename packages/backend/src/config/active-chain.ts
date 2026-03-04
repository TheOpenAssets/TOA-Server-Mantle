import { Chain } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { creditcoinTestnet } from '@/src/config/creditcoin-chain';
import { mantleSepolia } from '@/src/config/mantle-chain';

/**
 * Returns the active viem Chain object based on the NETWORK_TYPE environment variable.
 *
 * Supported values:
 *  - 'creditcoin'  → Creditcoin Testnet (CC3)
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

  return mantleSepolia;
}
