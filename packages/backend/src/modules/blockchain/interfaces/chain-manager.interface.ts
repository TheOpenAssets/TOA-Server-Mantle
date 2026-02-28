import { NetworkType } from '@openassets/types';
import { ContractAdapter } from '../adapters/contract-adapter.interface';

export interface ChainManager {
  getType(): NetworkType;
  getContractAdapter(): ContractAdapter;
  startBackgroundOperations(): Promise<void>;
  stopBackgroundOperations(): Promise<void>;
}
