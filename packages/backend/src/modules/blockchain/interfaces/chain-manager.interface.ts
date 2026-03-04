import { NetworkType } from '@openassets/types';
import { ContractAdapter } from '../adapters/contract-adapter.interface';
import { BlockchainAdapter } from '../adapters/blockchain-adapter.interface';

export interface ChainManager {
  getType(): NetworkType;
  getContractAdapter(): ContractAdapter;
  getBlockchainAdapter(): BlockchainAdapter;
  startBackgroundOperations(): Promise<void>;
  stopBackgroundOperations(): Promise<void>;
}
