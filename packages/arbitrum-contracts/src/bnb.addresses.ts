import { ContractName } from '@openassets/types';

/**
 * BNB testnet deployment addresses.
 *
 * Populate this map after running:
 *   pnpm --filter @contracts/arbitrum deploy:bnb:testnet
 */
export const BnbContracts: Partial<Record<ContractName, string>> = {};
