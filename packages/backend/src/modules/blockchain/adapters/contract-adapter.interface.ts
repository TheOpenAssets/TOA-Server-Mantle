import { ContractName } from '@openassets/types';

export interface ContractAdapter {
  hasContract(name: ContractName | string): boolean;
  getContractAddress(name: ContractName | string): string;
  getContractInterface(name: ContractName | string): any; // ABI for EVM, Spec for Stellar
}
