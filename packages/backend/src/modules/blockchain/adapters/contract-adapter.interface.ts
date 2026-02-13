export interface ContractAdapter {
  hasContract(name: string): boolean;
  getContractAddress(name: string): string;
  getContractInterface(name: string): any; // ABI for EVM, Spec for Stellar
}
